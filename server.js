const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const { promisify } = require('util');
const app     = express();
const scrypt = promisify(crypto.scrypt);

const requestMetrics = new Map();
const escapeLabel = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
        const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;
        const key = `${req.method} ${route} ${res.statusCode}`;
        const current = requestMetrics.get(key) || { count: 0, seconds: 0 };
        current.count += 1;
        current.seconds += Number(process.hrtime.bigint() - started) / 1e9;
        requestMetrics.set(key, current);
    });
    next();
});

app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── DATABASE ──────────────────────────────────────────────
const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, 'campus_planner.db'));
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("❌ Database Error: ", err.message);
    else     console.log(`Connected to SQLite: ${dbPath}`);
});

app.get('/health', (req, res) => {
    db.get('SELECT 1 AS ok', [], (err) => {
        if (err) return res.status(503).json({ status: 'unhealthy' });
        res.json({ status: 'ok' });
    });
});

app.get('/metrics', (req, res) => {
    const lines = [
        '# HELP event_app_http_requests_total Total HTTP requests handled by the application.',
        '# TYPE event_app_http_requests_total counter',
        '# HELP event_app_http_request_duration_seconds_sum Total request duration in seconds.',
        '# TYPE event_app_http_request_duration_seconds_sum counter',
        '# HELP event_app_http_request_duration_seconds_count Number of requests observed.',
        '# TYPE event_app_http_request_duration_seconds_count counter',
    ];
    for (const [key, metric] of requestMetrics) {
        const [method, route, status] = key.split(' ');
        const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`;
        lines.push(`event_app_http_requests_total{${labels}} ${metric.count}`);
        lines.push(`event_app_http_request_duration_seconds_sum{${labels}} ${metric.seconds}`);
        lines.push(`event_app_http_request_duration_seconds_count{${labels}} ${metric.count}`);
    }
    res.type('text/plain; version=0.0.4; charset=utf-8').send(`${lines.join('\n')}\n`);
});

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scrypt(password, salt, 64);
    return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    if (!stored.startsWith('scrypt$')) return stored === password;
    const [, salt, expectedHex] = stored.split('$');
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await scrypt(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE, venue TEXT, time TEXT, date TEXT,
        dept TEXT, type TEXT, anchor_name TEXT,
        held INTEGER DEFAULT 0, attendees INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE, pass TEXT, role TEXT DEFAULT 'user'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT, event_name TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_name TEXT, user_email TEXT,
        rating INTEGER, review TEXT, suggestion TEXT
    )`);

    db.run(`CREATE VIEW IF NOT EXISTS event_stats AS
        SELECT type,
               COUNT(*) as total_events,
               SUM(held) as held_events,
               COUNT(*) - SUM(held) as live_events
        FROM events GROUP BY type`);

    db.run(`CREATE VIEW IF NOT EXISTS suggestions_by_event AS
        SELECT event_name, GROUP_CONCAT(suggestion, ' | ') as all_suggestions
        FROM suggestions GROUP BY event_name`);

    db.run(`CREATE VIEW IF NOT EXISTS user_activity AS
        SELECT user_email, GROUP_CONCAT(event_name, ', ') as applied_events
        FROM user_applications GROUP BY user_email`);
});

// ── GET ALL EVENTS ────────────────────────────────────────
app.get('/api/events', (req, res) => {
    db.all("SELECT * FROM events", [], (err, rows) => {
        if (err) return res.status(500).json([]);
        const now = new Date().getTime();

        const formatted = rows.map(r => {
            const eventTime = new Date(`${r.date}T${r.time}:00`).getTime();
            let isHeld = (eventTime <= now) || (r.held === 1);
            if (isHeld && r.held === 0) {
                db.run(`UPDATE events SET held = 1 WHERE id = ?`, [r.id]);
            }
            return { ...r, held: isHeld };
        });

        res.json(formatted);
    });
});

// ── CREATE EVENT ──────────────────────────────────────────
app.post('/api/events', (req, res) => {
    const { name, venue, time, date, dept, type, anchor_name } = req.body;
    db.run(
        `INSERT INTO events (name, venue, time, date, dept, type, anchor_name) VALUES (?,?,?,?,?,?,?)`,
        [name, venue, time, date, dept, type, anchor_name],
        function (err) {
            if (err) return res.status(400).json({ success: false, error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ── DELETE EVENT  🆕 ──────────────────────────────────────
// Deletes the event and all related user_applications & suggestions
app.delete('/api/events/:name', (req, res) => {
    const { name } = req.params;

    db.serialize(() => {
        // Delete related suggestions first
        db.run(`DELETE FROM suggestions WHERE event_name = ?`, [name], (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });

            // Delete related applications
            db.run(`DELETE FROM user_applications WHERE event_name = ?`, [name], (err2) => {
                if (err2) return res.status(500).json({ success: false, error: err2.message });

                // Delete the event itself
                db.run(`DELETE FROM events WHERE name = ?`, [name], function (err3) {
                    if (err3) return res.status(500).json({ success: false, error: err3.message });
                    if (this.changes === 0) {
                        return res.status(404).json({ success: false, error: "Event not found." });
                    }
                    console.log(`🗑️  Deleted event: "${name}" (and related data)`);
                    res.json({ success: true });
                });
            });
        });
    });
});

// ── MARK EVENT HELD ───────────────────────────────────────
app.patch('/api/events/:name/held', (req, res) => {
    const { name }      = req.params;
    const { attendees } = req.body;
    db.run(
        `UPDATE events SET held = 1, attendees = ? WHERE name = ?`,
        [attendees, name],
        function (err) {
            if (err) return res.status(400).json({ success: false, error: err.message });
            res.json({ success: true });
        }
    );
});

// ── APPLY FOR EVENT ───────────────────────────────────────
app.post('/api/apply', (req, res) => {
    const { user_email, event_name } = req.body;
    db.run(
        `INSERT INTO user_applications (user_email, event_name) VALUES (?,?)`,
        [user_email, event_name],
        (err) => {
            if (err) return res.status(400).json({ success: false });
            res.json({ success: true });
        }
    );
});

// ── GET APPLICATIONS ──────────────────────────────────────
app.get('/api/users/:email/applications', (req, res) => {
    db.all(
        `SELECT event_name FROM user_applications WHERE user_email = ?`,
        [req.params.email],
        (err, rows) => {
            if (err) return res.status(500).json([]);
            res.json(rows.map(r => r.event_name));
        }
    );
});

// ── SUBMIT REVIEW ─────────────────────────────────────────
app.post('/api/reviews', (req, res) => {
    const { event_name, user_email, rating, review, suggestion } = req.body;
    db.run(
        `INSERT INTO suggestions (event_name, user_email, rating, review, suggestion) VALUES (?,?,?,?,?)`,
        [event_name, user_email, rating, review, suggestion],
        function (err) {
            if (err) return res.status(400).json({ success: false, error: err.message });
            res.json({ success: true });
        }
    );
});

// ── ANALYTICS ─────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
    db.all(`SELECT * FROM suggestions`, [], (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows);
    });
});

// ── STATS VIEWS ───────────────────────────────────────────
app.get('/api/stats', (req, res) => {
    db.all(`SELECT * FROM event_stats`, [], (err, stats) => {
        db.all(`SELECT * FROM suggestions_by_event`, [], (err2, suggs) => {
            res.json({ stats: stats || [], suggestions: suggs || [] });
        });
    });
});

app.get('/api/userStats/:email', (req, res) => {
    const { email } = req.params;
    db.get(
        `SELECT COUNT(*) as applied_events FROM user_applications WHERE user_email = ?`,
        [email],
        (err, row) => {
            const appliedCount = row ? row.applied_events : 0;
            db.all(
                `SELECT e.type, COUNT(*) as attended_count
                 FROM user_applications ua
                 JOIN events e ON ua.event_name = e.name
                 WHERE ua.user_email = ? AND e.held = 1
                 GROUP BY e.type`,
                [email],
                (err2, rows) => {
                    res.json({ appliedCount, attendedByType: rows || [] });
                }
            );
        }
    );
});

// ── AUTHENTICATION ────────────────────────────────────────
app.post('/api/users/login', (req, res) => {
    const { email, pass, role } = req.body;
    if (role === "admin") {
        if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD &&
            email === process.env.ADMIN_USERNAME && pass === process.env.ADMIN_PASSWORD) {
            return res.json({ success: true, user: { email: process.env.ADMIN_USERNAME, role: "admin" } });
        }
        return res.status(401).json({ success: false, message: "Invalid Admin Login" });
    }

    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err)  return res.status(500).json({ success: false });
        if (!user) return res.status(401).json({ success: false, message: "User not found" });
        verifyPassword(pass, user.pass).then((valid) => {
            if (!valid) return res.status(401).json({ success: false, message: "Incorrect password" });
            if (!user.pass.startsWith('scrypt$')) {
                hashPassword(pass).then((encoded) => db.run('UPDATE users SET pass = ? WHERE id = ?', [encoded, user.id]));
            }
            res.json({ success: true, user: { email: user.email, role: "user" } });
        }).catch(() => res.status(500).json({ success: false }));
    });
});

app.post('/api/users/register', (req, res) => {
    const { email, pass } = req.body;
    if (typeof email !== 'string' || !email.includes('@') || typeof pass !== 'string' || pass.length < 8) {
        return res.status(400).json({ success: false, message: "Enter a valid email and a password of at least 8 characters." });
    }
    hashPassword(pass).then((encoded) => db.run(
        `INSERT INTO users (email, pass, role) VALUES (?, ?, 'user')`,
        [email.trim().toLowerCase(), encoded],
        function (err) {
            if (err) return res.status(400).json({ success: false, message: "Email may already exist." });
            res.json({ success: true });
        }
    )).catch(() => res.status(500).json({ success: false }));
});

// ── START ─────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is live on port ${PORT}`);
        console.log(`SQLite database: ${dbPath}`);
    });
}

module.exports = { app, db };
