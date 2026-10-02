// ============================================================
//  Smart Campus Event Planner — script.js (Enhanced)
// ============================================================

let currentUser = JSON.parse(localStorage.getItem("loggedUser"));
let isLoginMode = true;
let editIndex = null;
let activeReviewName = "";
let pendingDeleteName = null;  // 🆕 Tracks event to delete

// ============================================================
//  TOAST NOTIFICATION UTILITY
// ============================================================
function showToast(msg, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.className = "toast" + (isError ? " error" : "");
    // Force reflow to restart animation
    void toast.offsetWidth;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3200);
}

// ============================================================
//  DASHBOARD ROUTING
// ============================================================
async function init() {
    if (currentUser) {
        document.getElementById("loginBtn").textContent = "Logout";
        if (currentUser.role === "admin") {
            document.getElementById("adminDashboard").style.display = "block";
            await renderAdminDashboard();
        } else {
            document.getElementById("userDashboard").style.display = "block";
            document.getElementById("userWelcome").textContent = `Hello, ${currentUser.email.split('@')[0]}!`;
            await renderUserDashboard();
            setupReminders();
            updateUserReminder();
        }
    }
}

// ============================================================
//  AUTH — TOGGLE FIELDS
// ============================================================
function toggleFields() {
    // Both regular users and administrators need a password for login.
    document.getElementById("authPass").style.display = "block";
}

document.getElementById("loginBtn").addEventListener("click", () => {
    if (currentUser) {
        localStorage.removeItem("loggedUser");
        location.reload();
    } else {
        document.getElementById("authModal").style.display = "flex";
        toggleFields();
    }
});

document.getElementById("authBtn").addEventListener("click", async () => {
    const email = document.getElementById("authEmail").value.trim();
    const pass  = document.getElementById("authPass").value.trim();
    const role  = document.querySelector('input[name="loginRole"]:checked').value;

    if (!email || (role === "admin" && !pass)) return showToast("Please fill in all details.", true);

    if (isLoginMode) {
        try {
            const res  = await fetch('/api/users/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, pass, role })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem("loggedUser", JSON.stringify(data.user));
                location.reload();
            } else {
                showToast(data.message || "Login failed", true);
            }
        } catch (e) {
            showToast("Error connecting to server", true);
        }
    } else {
        if (role === "admin") return showToast("Cannot register as admin.", true);
        if (!pass) return showToast("Password required.", true);

        try {
            const res  = await fetch('/api/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, pass })
            });
            const data = await res.json();
            if (data.success) {
                showToast("Registered! Please login.");
                setTimeout(() => location.reload(), 1500);
            } else {
                showToast(data.message || "Registration failed", true);
            }
        } catch (e) {
            showToast("Error connecting to server", true);
        }
    }
});

document.getElementById("switchLink").addEventListener("click", () => {
    isLoginMode = !isLoginMode;
    document.getElementById("authTitle").textContent   = isLoginMode ? "Login"   : "Register";
    document.getElementById("authBtn").textContent     = isLoginMode ? "Proceed" : "Register";
    document.getElementById("switchLink").textContent  = isLoginMode
        ? "Don't have an account? Register"
        : "Already have an account? Login";
    toggleFields();
});

// ============================================================
//  USER: REMINDERS & NOTIFICATIONS
// ============================================================
async function setupReminders() {
    try {
        const eventsRes     = await fetch('/api/events');
        const events        = await eventsRes.json();
        const appsRes       = await fetch(`/api/users/${currentUser.email}/applications`);
        const appliedEvents = await appsRes.json();
        const upcomingEvents = events.filter(ev => !ev.held && appliedEvents.includes(ev.name));

        const sortedUpcoming = upcomingEvents.sort(
            (a, b) => new Date(`${a.date}T${a.time}:00`) - new Date(`${b.date}T${b.time}:00`)
        );

        if (sortedUpcoming.length > 0) {
            const nextEvent = sortedUpcoming[0];
            const dist = new Date(`${nextEvent.date}T${nextEvent.time}:00`).getTime() - new Date().getTime();
            if (dist > 0) {
                const hours = Math.floor(dist / (1000 * 60 * 60));
                const mins  = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
                showToast(`⏰ ${nextEvent.name} starts in ${hours}h ${mins}m`);
            }
        }

        if ("Notification" in window) {
            if (Notification.permission !== "granted") Notification.requestPermission();
            upcomingEvents.forEach(ev => {
                const timeUntil = new Date(`${ev.date}T${ev.time}:00`).getTime()
                    - new Date().getTime() - (10 * 60000);
                if (timeUntil > 0 && timeUntil < 86400000) {
                    setTimeout(() => {
                        new Notification(`🔔 Reminder: ${ev.name}`, {
                            body: `Starting in 10 minutes at ${ev.venue}!`
                        });
                    }, timeUntil);
                }
            });
        }
    } catch (e) { /* silent */ }
}

// ============================================================
//  USER: APPLY FOR EVENT
// ============================================================
window.apply = async (name) => {
    try {
        const res = await fetch('/api/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: currentUser.email, event_name: name })
        });
        if (res.ok) {
            showToast(`✅ Applied for "${name}"!`);
            await renderUserDashboard();
            setupReminders();
            updateUserReminder();
        }
    } catch (e) { showToast("Failed to apply", true); }
};

// ============================================================
//  ADMIN: DELETE EVENT  🆕
// ============================================================

/**
 * deleteEvent(name)
 * Opens a confirmation modal; on confirm calls DELETE /api/events/:name
 * and refreshes the admin dashboard.
 */
window.deleteEvent = (name) => {
    pendingDeleteName = name;
    document.getElementById("deleteModalMsg").textContent =
        `"${name}" and all related applications & suggestions will be permanently removed.`;
    document.getElementById("deleteModal").style.display = "flex";
};

document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
    if (!pendingDeleteName) return;
    document.getElementById("deleteModal").style.display = "none";

    try {
        const res = await fetch(`/api/events/${encodeURIComponent(pendingDeleteName)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            showToast(`🗑️ "${pendingDeleteName}" deleted successfully.`);
            pendingDeleteName = null;
            await renderAdminDashboard();
        } else {
            showToast(data.error || "Failed to delete event.", true);
        }
    } catch (e) {
        showToast("Error connecting to server.", true);
    }
});

document.getElementById("cancelDeleteBtn").addEventListener("click", () => {
    document.getElementById("deleteModal").style.display = "none";
    pendingDeleteName = null;
});

// ============================================================
//  ADMIN: RENDER DASHBOARD
// ============================================================
async function renderAdminDashboard() {
    const activeGrid    = document.getElementById("adminActiveGrid");
    const analyticsGrid = document.getElementById("analyticsSection");
    activeGrid.innerHTML = "";
    analyticsGrid.innerHTML = "";

    try {
        const [eventsRes, analyticsRes] = await Promise.all([
            fetch('/api/events'),
            fetch('/api/analytics')
        ]);
        const events  = await eventsRes.json();
        const reviews = await analyticsRes.json();

        let aCount = 0, hCount = 0;

        events.forEach((ev, i) => {
            if (!ev.held) {
                aCount++;
                // Live event card — with Delete button
                activeGrid.innerHTML += `
                    <div class="event-card">
                        <h4>${ev.name}</h4>
                        <p>📍 ${ev.venue} | 📅 ${ev.date}</p>
                        <p style="color:var(--secondary); font-weight:600;">🕐 ${ev.time}</p>
                        <p style="font-size:0.8rem; color:var(--text-muted);">
                            🏷️ ${ev.type} &nbsp;|&nbsp; 🏛️ ${ev.dept}
                            ${ev.anchor_name ? `&nbsp;|&nbsp; 🎤 ${ev.anchor_name}` : ""}
                        </p>
                        <div class="card-actions">
                            <button class="btn-delete" onclick="deleteEvent('${ev.name.replace(/'/g, "\\'")}')">
                                🗑️ Delete
                            </button>
                        </div>
                    </div>`;
            } else {
                hCount++;
                const eventReviews = reviews.filter(r => r.event_name === ev.name);
                const avgRating = eventReviews.length
                    ? eventReviews.reduce((sum, r) => sum + Number(r.rating), 0) / eventReviews.length
                    : 0;

                // Analytics card — with Delete button
                analyticsGrid.innerHTML += `
                    <div class="analytics-card">
                        <h4>📊 ${ev.name}</h4>
                        <p>⭐ Avg Rating: <strong>${avgRating.toFixed(1)}</strong></p>
                        <p>👥 Attendees: <strong>${ev.attendees}</strong>
                            <button style="padding:2px 8px; font-size:0.78rem; margin-left:10px;"
                                onclick="updateAttendees('${ev.name.replace(/'/g, "\\'")}')">Edit</button>
                        </p>
                        <canvas id="chart-${i}" width="200" height="100"></canvas>
                        <div style="margin-top:12px;">
                            <strong>Reviews:</strong><br>
                            ${eventReviews.map(r => `• ${r.review}`).join("<br>") || "<em>None yet</em>"}
                        </div>
                        <div style="margin-top:10px; color:var(--secondary);">
                            <strong>Suggestions:</strong><br>
                            ${eventReviews.map(r => `💡 ${r.suggestion}`).join("<br>") || "<em>None yet</em>"}
                        </div>
                        <div class="card-actions" style="margin-top:14px;">
                            <button class="btn-delete" onclick="deleteEvent('${ev.name.replace(/'/g, "\\'")}')">
                                🗑️ Delete
                            </button>
                        </div>
                    </div>`;

                setTimeout(() => generateGraph(`chart-${i}`, eventReviews), 100);
            }
        });

        document.getElementById("activeCount").textContent = aCount;
        document.getElementById("heldCount").textContent   = hCount;
    } catch (e) {
        console.error("Admin dashboard load failed", e);
    }
}

// ============================================================
//  GRAPH GENERATOR
// ============================================================
function generateGraph(canvasId, reviews) {
    const counts = [0, 0, 0, 0, 0];
    reviews.forEach(r => { if (r.rating >= 1 && r.rating <= 5) counts[r.rating - 1]++; });

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: ['1⭐', '2⭐', '3⭐', '4⭐', '5⭐'],
            datasets: [{
                label: 'Ratings',
                data: counts,
                backgroundColor: 'rgba(0,188,212,0.7)',
                borderColor: '#00bcd4',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

// ============================================================
//  UTILS: UPDATE ATTENDEES
// ============================================================
window.updateAttendees = async (name) => {
    let count = prompt("Total attendees?");
    if (count === null) return;
    count = parseInt(count);
    if (isNaN(count) || count < 0) {
        showToast("Please enter a valid number.", true);
        return window.updateAttendees(name);
    }
    try {
        const res = await fetch(`/api/events/${encodeURIComponent(name)}/held`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendees: count })
        });
        if (res.ok) {
            showToast(`✅ Attendees updated for "${name}"`);
            renderAdminDashboard();
        }
    } catch (e) { showToast("Failed to update attendees.", true); }
};

// ============================================================
//  REVIEW MODAL
// ============================================================
window.openReview = (name) => {
    activeReviewName = name;
    document.getElementById("reviewModal").style.display = "flex";
};

document.getElementById("submitReviewBtn").addEventListener("click", async () => {
    const text       = document.getElementById("reviewText").value.trim();
    const suggestion = document.getElementById("suggestionText").value.trim();

    if (!text && !suggestion) {
        return showToast("Please enter a review or suggestion.", true);
    }

    const rev = {
        event_name: activeReviewName,
        user_email: currentUser.email,
        rating:     document.getElementById("rateVal").value,
        review:     text,
        suggestion: suggestion
    };

    try {
        const res = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rev)
        });
        if (res.ok) {
            document.getElementById("reviewModal").style.display = "none";
            document.getElementById("reviewText").value      = "";
            document.getElementById("suggestionText").value  = "";
            showToast("✅ Feedback submitted!");
            renderUserDashboard();
        } else {
            showToast("Failed to submit review", true);
        }
    } catch (e) { showToast("Error submitting review", true); }
});

// ============================================================
//  USER DASHBOARD
// ============================================================
async function renderUserDashboard() {
    const exploreGrid  = document.getElementById("exploreGrid");
    const appliedList  = document.getElementById("appliedList");
    const attendedList = document.getElementById("attendedList");
    exploreGrid.innerHTML = "";
    appliedList.innerHTML = "";
    attendedList.innerHTML = "";

    try {
        const [eventsRes, appsRes, analyticsRes] = await Promise.all([
            fetch('/api/events'),
            fetch(`/api/users/${currentUser.email}/applications`),
            fetch('/api/analytics')
        ]);

        const events        = await eventsRes.json();
        const appliedEvents = await appsRes.json();
        const allReviews    = await analyticsRes.json();
        const userReviews   = allReviews.filter(r => r.user_email === currentUser.email);

        events.forEach(ev => {
            const isApplied = appliedEvents.includes(ev.name);

            if (ev.held && isApplied) {
                const reviewed = userReviews.some(r => r.event_name === ev.name);
                attendedList.innerHTML += `
                    <li>
                        <span>${ev.name}</span>
                        ${reviewed
                            ? '<span style="color:var(--secondary);font-weight:600;">✅ Reviewed</span>'
                            : `<button onclick="openReview('${ev.name.replace(/'/g, "\\'")}')">⭐ Rate</button>`}
                    </li>`;
            } else if (!ev.held) {
                if (isApplied) {
                    appliedList.innerHTML += `
                        <li>
                            <span><strong>${ev.name}</strong> — ${ev.venue}</span>
                            <span style="color:var(--secondary); font-size:0.82rem;">📅 ${ev.date}</span>
                        </li>`;
                } else {
                    exploreGrid.innerHTML += `
                        <div class="event-card">
                            <h4>${ev.name}</h4>
                            <p>🎭 ${ev.type} &nbsp;|&nbsp; 🎤 ${ev.anchor_name || "N/A"}</p>
                            <p>📍 ${ev.venue} &nbsp;|&nbsp; 📅 ${ev.date}</p>
                            <p>🕐 ${ev.time} &nbsp;|&nbsp; 🏛️ ${ev.dept}</p>
                            <div class="card-actions">
                                <button onclick="apply('${ev.name.replace(/'/g, "\\'")}')">✅ Apply</button>
                            </div>
                        </div>`;
                }
            }
        });

        if (exploreGrid.innerHTML === "") {
            exploreGrid.innerHTML = `<p style="color:var(--text-muted); padding:10px;">No available events right now.</p>`;
        }
        if (appliedList.innerHTML === "") {
            appliedList.innerHTML = `<li style="color:var(--text-muted);">You haven't applied to any events yet.</li>`;
        }
        if (attendedList.innerHTML === "") {
            attendedList.innerHTML = `<li style="color:var(--text-muted);">No completed events to review.</li>`;
        }
    } catch (e) { console.error("Error loading user dashboard", e); }
}

// ============================================================
//  USER REMINDER COUNTDOWN
// ============================================================
async function updateUserReminder() {
    const timerEl = document.getElementById("userTimer");
    if (!timerEl) return;

    try {
        const [eventsRes, appsRes] = await Promise.all([
            fetch('/api/events'),
            fetch(`/api/users/${currentUser.email}/applications`)
        ]);
        const events        = await eventsRes.json();
        const appliedEvents = await appsRes.json();

        if (!appliedEvents.length) {
            timerEl.textContent = "No upcoming events applied.";
            return;
        }

        const upcomingApplied = events
            .filter(ev => !ev.held && appliedEvents.includes(ev.name))
            .sort((a, b) => new Date(`${a.date}T${a.time}:00`) - new Date(`${b.date}T${b.time}:00`))[0];

        if (!upcomingApplied) {
            timerEl.textContent = "All your applied events have finished!";
            return;
        }

        const target = new Date(`${upcomingApplied.date}T${upcomingApplied.time}:00`).getTime();

        setInterval(() => {
            const dist = target - new Date().getTime();
            if (dist < 0) {
                timerEl.textContent = `${upcomingApplied.name} is starting now! 🔔`;
                return;
            }
            const h = Math.floor((dist % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const m = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((dist % (1000 * 60)) / 1000);
            timerEl.textContent = `${upcomingApplied.name} starts in: ${h}h ${m}m ${s}s`;
        }, 1000);
    } catch (e) { /* silent */ }
}

// ============================================================
//  EVENT FORM — CREATE EVENT
// ============================================================
document.getElementById("eventForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ev = {
        name:        document.getElementById("eName").value,
        venue:       document.getElementById("eVenue").value,
        time:        document.getElementById("eTime").value,
        date:        document.getElementById("eDate").value,
        dept:        document.getElementById("eDept").value,
        type:        document.getElementById("eType").value,
        anchor_name: document.getElementById("eAnchor").value
    };

    try {
        const res  = await fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ev)
        });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ Event "${ev.name}" created!`);
            renderAdminDashboard();
            e.target.reset();
        } else {
            showToast("Failed: " + (data.error || "Unknown error"), true);
        }
    } catch (e) { showToast("Error connecting to server.", true); }
});

// ============================================================
//  DARK MODE TOGGLE
// ============================================================
document.getElementById("modeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    document.getElementById("modeBtn").textContent =
        document.body.classList.contains("dark") ? "☀️" : "🌙";
});

// ============================================================
//  CURSOR GLOW TRAIL
// ============================================================
document.addEventListener("mousemove", (e) => {
    const glow = document.createElement("div");
    glow.className = "cursor-glow";
    glow.style.left = e.clientX + "px";
    glow.style.top  = e.clientY + "px";
    document.body.appendChild(glow);
    setTimeout(() => glow.remove(), 500);
});

// ============================================================
//  INIT
// ============================================================
init();
