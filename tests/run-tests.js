const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'college-events-'));
    process.env.DB_PATH = path.join(tempDir, 'test.sqlite');
    const { app, db } = require('../server');
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const checks = [
        ['health endpoint confirms SQLite connection', async () => {
            const response = await fetch(`${baseUrl}/health`);
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { status: 'ok' });
        }],
        ['events can be created and listed', async () => {
            const created = await fetch(`${baseUrl}/api/events`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'DevOps Demo', venue: 'Auditorium', time: '10:00', date: '2099-01-01', dept: 'CS', type: 'Tech', anchor_name: 'A Student' }),
            });
            assert.equal(created.status, 200);
            assert.equal((await created.json()).success, true);
            const listed = await fetch(`${baseUrl}/api/events`);
            assert.equal((await listed.json()).some((event) => event.name === 'DevOps Demo'), true);
        }],
        ['registration hashes passwords and login accepts the correct password', async () => {
            const registered = await fetch(`${baseUrl}/api/users/register`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'student@example.edu', pass: 'campus-pass-123' }),
            });
            assert.equal(registered.status, 200);
            const stored = await new Promise((resolve, reject) => db.get('SELECT pass FROM users WHERE email = ?', ['student@example.edu'], (err, row) => err ? reject(err) : resolve(row)));
            assert.match(stored.pass, /^scrypt\$/);
            const login = await fetch(`${baseUrl}/api/users/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'student@example.edu', pass: 'campus-pass-123', role: 'user' }),
            });
            assert.equal(login.status, 200);
            assert.equal((await login.json()).success, true);
        }],
        ['registration rejects a weak password', async () => {
            const response = await fetch(`${baseUrl}/api/users/register`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'student@example.edu', pass: 'short' }),
            });
            assert.equal(response.status, 400);
        }],
        ['metrics endpoint exposes request counters', async () => {
            const response = await fetch(`${baseUrl}/metrics`);
            const body = await response.text();
            assert.equal(response.status, 200);
            assert.match(body, /event_app_http_requests_total/);
            assert.equal(body.includes('route="/health"'), true);
        }],
    ];

    let failures = 0;
    for (const [name, check] of checks) {
        try {
            await check();
            console.log(`PASS ${name}`);
        } catch (error) {
            failures += 1;
            console.error(`FAIL ${name}\n${error.stack || error}`);
        }
    }

    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve, reject) => db.close((err) => err ? reject(err) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`${checks.length - failures}/${checks.length} checks passed.`);
    if (failures) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
