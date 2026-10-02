# College Event Management System

A web application for managing campus events, event applications, and attendee feedback. This project adds an automated GitHub Actions workflow, automated tests, Docker deployment, and Prometheus/Grafana monitoring.

## Technology

- Node.js 22, Express, SQLite, and a static HTML/CSS/JavaScript frontend
- Git and GitHub for source control
- GitHub Actions for continuous integration (Jenkins is not used)
- Docker Compose for local deployment
- Prometheus and Grafana for monitoring
- Node.js built-in test runner for API and application checks

## Run locally

1. Install Node.js 22.9 or newer.
2. Copy `.env.example` to `.env` and set a private `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
3. Install dependencies with `npm ci`.
4. Start the application with `npm start`.
5. Open <http://localhost:3000>.

The SQLite database is created locally. Set `DB_PATH` to choose its location. Never commit `.env` or database files.

## Tests and continuous integration

Run the same tests locally that GitHub Actions runs:

```sh
npm ci
npm test
```

The workflow at `.github/workflows/ci.yml` runs on pushes and pull requests targeting `main` or `master`. It installs dependencies, runs the tests, and builds a Docker image. The Actions run page records the build and test result for screenshots/evidence.

## Run the full DevOps stack

1. Copy `.env.example` to `.env` and set private credentials.
2. Start Docker Desktop (or another Docker Engine with Compose).
3. Run `docker compose up --build -d`.
4. Open the app at <http://localhost:3000>, Prometheus at <http://localhost:9090>, and Grafana at <http://localhost:3001>.
5. Sign in to Grafana with username `admin` and the `GRAFANA_PASSWORD` from `.env` (or its documented local default). The provisioned **College Event Management** dashboard shows HTTP request rate and duration after Prometheus has scraped the app.
6. Check `/health` on port 3000 and Prometheus's **Status > Targets** page to confirm the app is healthy and being scraped.

To stop the services, run `docker compose down`. To remove persisted local data as well, run `docker compose down -v` (this deletes the app database and monitoring history).

## Endpoints

- `GET /health` - application and SQLite readiness
- `GET /metrics` - Prometheus request counters and duration metrics
- `GET /api/events` and `POST /api/events` - list and create events
- `POST /api/users/register` and `POST /api/users/login` - registration and login

New passwords are stored using salted scrypt hashes. Existing plaintext passwords are upgraded to a hash on successful login. Configure the administrator account using `ADMIN_USERNAME` and `ADMIN_PASSWORD`; there is no default administrator credential in the source code.

## GitHub setup for the student group

Create one GitHub repository for the group, add all group members as collaborators, and push this source as the shared project. Keep each student's commits attributable to the student who made them; do not manufacture commit history. Store real credentials in local `.env` or GitHub Actions secrets, never in tracked files. Push a change or open a pull request to see the workflow run.

The assignment also asks the group to prepare a report, screenshots/evidence, and a final presentation/live demonstration. Those student-specific materials are intentionally left for you to complete later.
