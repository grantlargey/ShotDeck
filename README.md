# ScriptDeck

ScriptDeck organizes films, screenplay PDFs, captured scenes, and timestamped film stills. Captured text can be edited manually or formatted with optional AI proposals.

The app uses React/Vite, Express, PostgreSQL, and S3-compatible storage. Locally, the client and API run on your machine; Docker runs PostgreSQL and local S3. No AWS account is needed.

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | 24.13.1 |
| npm | 11.x, bundled with Node |
| Docker | Engine 24+ with Compose v2 supporting `up --wait` |

Keep Docker running during development. On Windows, select the WSL 2 backend when installing Docker Desktop.

## First-time setup

Run these commands from the repository root.

### 1. Install dependencies

```bash
npm ci
npm run setup
```

### 2. Create your environment file

```bash
cp server/.env.example server/.env        # macOS / Linux / Git Bash
copy server\.env.example server\.env      # Windows cmd
```

The defaults match the local containers, including development S3 credentials. No editing or client environment file is required.

### 3. Start services and apply migrations

```bash
npm run services:up
npm run db:migrate
```

### 4. Create your owner account

```bash
npm run admin -- create-owner --email you@example.com
```

Enter a password of at least 12 characters when prompted.

### 5. Start the app

```bash
npm run dev
```

| Service | Address |
| --- | --- |
| App | http://localhost:5173 |
| API health check | http://localhost:4000/health |
| Local S3 console | http://localhost:9001 |

The S3 console login is `scriptdeck` / `scriptdeck-local`.

Sign in through the Admin link or `/login`, then create a project and upload a screenplay.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local services, API, and client. |
| `npm run services:up` | Start PostgreSQL and S3, wait for readiness, and create the bucket. |
| `npm run services:stop` | Stop containers while keeping their data. |
| `npm run services:logs` | Follow PostgreSQL and S3 logs. |
| `npm run db:migrate` | Apply pending database migrations. |

Migrations do not run automatically. Run `npm run db:migrate` after pulling changes that add migrations.

### Reset local data

```bash
npm run services:reset
```

**This deletes the local database, admin accounts, and all uploaded media.** The command displays the affected volumes and requires you to type `reset`.

Afterward, repeat setup steps 3–5. For ordinary container problems, try `docker compose restart db s3` first.

## Configuration

The server reads `server/.env`, with shell environment variables taking precedence.

| Setting | When to change it |
| --- | --- |
| `DATABASE_URL` | Use a different PostgreSQL instance. |
| `PORT` | Change the API port from `4000`. |
| `AWS_ENDPOINT_URL_S3` | Point to another S3-compatible service; unset for real AWS. |
| `AWS_REGION`, `S3_BUCKET` | Change the storage region or bucket. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Change storage credentials. Local values are supplied in the example file. |
| `S3_PUBLIC_ENDPOINT` | Give the browser a different storage address from the API. |
| `ALLOWED_ORIGINS` | Allow additional browser origins. |
| `OPENAI_API_KEY` | Enable optional AI formatting. |
| `OPENAI_SCREENPLAY_TIMEOUT_MS` | Change the AI request timeout from `90000` ms. |
| `ADMIN_PASSWORD` | Supply an admin CLI password without the interactive prompt. |

The client defaults to `http://localhost:4000`. Override it with `VITE_API_BASE` in `client/.env`. Client variables are embedded in browser assets and must not contain secrets.

Restart the relevant development process after changing configuration.

## Tests and checks

| Command | Purpose |
| --- | --- |
| `npm test --prefix client` | Client tests. |
| `npm run lint --prefix client` | Client lint. |
| `npm run build --prefix client` | Production client build. |
| `npm run lint --prefix server` | Server lint. |
| `npm run check:unused` | Check unused code and dependencies. |
| `npm test --prefix server` | API tests; requires PostgreSQL running. |
| `npm run smoke:browser` | Browser smoke test; requires PostgreSQL running. |

Start PostgreSQL with `npm run services:up`. Before the first browser smoke run, install Chromium:

```bash
npx playwright install chromium
```

Server and browser tests create and clean up separate test databases and isolate external services from real credentials.

To run selected server tests:

```bash
npm test --prefix server -- test/auth.test.js
npm test --prefix server -- --test-name-pattern="signing in"
```

Use `TEST_DATABASE_ADMIN_URL` or `SMOKE_DATABASE_ADMIN_URL` to test against a different PostgreSQL instance. Concurrent server test runs need distinct `TEST_DB_SUFFIX` values.

GitHub Actions runs the unused-code check, client lint/tests/build, and server lint/tests on pushes and pull requests.

## Admin access

Reading is public; editing requires an admin account. There is no public sign-up.

The owner manages accounts through **Account menu → Manage admins**, including adding admins, resetting passwords, and disabling access.

For CLI account management:

```bash
npm run admin -- list
npm run admin -- reset-password --email you@example.com
```

Password resets and account disabling invalidate existing sessions.

## Architecture

| Location | Responsibility |
| --- | --- |
| `client/src/` | React UI, page workflows, and browser API clients. |
| `server/src/routes/` | HTTP handlers and access guards. |
| `server/src/services/` | Domain rules, validation, database operations, and response shaping. |
| `server/src/repositories/` | Extracted persistence code. |
| `server/sql/migrations/` | Numbered database migrations. |
| `test/browser-smoke/` | End-to-end browser checks. |
| `scripts/` | Repository tooling. |
| `docker-compose.yml` | Local PostgreSQL, S3, and optional containerized API. |

Frontend dependencies flow downward:

```text
app → pages → widgets → features → entities → shared
```

Pages own most workflows. Shared API clients live in `shared/api`; modules import concrete files directly.

Backend requests flow through:

```text
app → router → domain service → PostgreSQL / S3
```

Uploads go directly from the browser to storage using presigned URLs. The API stores object keys, signs viewing URLs, and generates 800px WebP thumbnails for film stills.

## Optional: containerized API

Stop any host API before running:

```bash
docker compose --profile container-api up --build
npm run dev --prefix client
```

Run the client command in a second terminal. The API container reads `server/.env`; API source changes require rebuilding.

Before returning to `npm run dev`:

```bash
docker compose --profile container-api stop api
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Docker daemon unavailable | Start Docker Desktop. |
| Port already in use | Stop the conflicting process. Default ports are 4000, 5173, 5432, 9000, and 9001. |
| Missing environment variables | Compare `server/.env` with `server/.env.example`. |
| Missing database tables | Run `npm run db:migrate`. |
| PostgreSQL unreachable or uploads failing | Run `npm run services:up`, then inspect `npm run services:logs`. |
| AI formatting unavailable | Set `OPENAI_API_KEY` if needed; manual editing still works without it. |
| App unavailable at `127.0.0.1:5173` | Use `http://localhost:5173`. |
| Wrong Node version | Install Node.js 24.13.1, reopen the terminal, and check your PATH. |