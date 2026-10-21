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
| `OPENAI_API_KEY` | Enable optional AI screenplay formatting. |
| `OPENAI_SCREENPLAY_TIMEOUT_MS` | Change the AI formatting timeout from `90000` ms. |
| `GEMINI_API_KEY` | Enable semantic scene search. |
| `GEMINI_TIMEOUT_MS` | Change the timeout for each semantic search request to Gemini from `30000` ms. |
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

## Semantic scene search

Script Search accepts a natural-language description ("a tense standoff in a
diner") and returns the captured scenes that match it, best match first. A
description that matches no scene finds nothing. Matching reads each scene's
captured text and the labels of its tags, and selected tag filters narrow the
scenes it considers.

Semantic search is optional and off by default. Without `GEMINI_API_KEY`, tag
browsing keeps working, the search box explains that the feature is not enabled,
and the semantic search endpoint answers `503`.

### How it works

`server/src/services/semantic-search.service.js` answers a search in three
steps:

1. **Candidates.** Two retrievers run under the same tag filters. One embeds the
   description with Gemini's `gemini-embedding-001` model and ranks scenes by
   cosine similarity. The other ranks them by the description's words with
   PostgreSQL full-text search (`english` stemming; any word may match). The
   two rankings are merged by reciprocal rank fusion, and the best 30 go on.
2. **Grading.** One `gemini-3.5-flash-lite` call reads the description and
   every candidate's text and tags, and grades each scene: 3 shows what was
   described, 2 mostly does, 1 is only related, 0 is unrelated. The grader
   sees the candidates in story order (film, then film time), not best first:
   shown best first, it accepted about six times as many unrelated scenes and
   missed exact matches, at the same speed.
3. **Acceptance.** Only scenes graded 2 or 3 come back, grade 3 first, then by
   how well they matched in step 1. A scene that contains the whole
   description as a phrase, such as a name, title or quote, counts as grade 3.
   If grading fails or times out, the search fails rather than return ungraded
   scenes.

Indexing:

- A scene is embedded from its tag labels plus its scene text, with the
  `RETRIEVAL_DOCUMENT` task; searches use `RETRIEVAL_QUERY`. A scene too long
  for one embedding (about 5,000 characters with its tag line) is split into
  overlapping chunks at paragraph breaks, and it ranks by its closest chunk.
- Vectors are stored in `scene_chunk_embeddings`, one 768-dimension `REAL[]`
  per chunk, with the model name and a hash of the scene's input. The stock
  `postgres:16` image works; no `pgvector` extension is required.
- Word search uses an expression index on `to_tsvector('english', scene_text)`,
  so nothing derived is stored on the scene row.
- Indexing is automatic. Saving a scene embeds it in the background, so the save
  never waits on Gemini, and the API checks every scene when it starts. That
  start-up pass catches scenes saved before the key was set and saves whose
  embedding failed.
- Indexing skips scenes whose text, tags and model already match, so the
  start-up pass is cheap. Changing the embedding model re-embeds everything
  because stored rows carry their model name.

Each search makes two Gemini calls: one small embedding and one grading call
that reads up to 30 scenes (about 15,000 tokens for 20 scenes, about two
seconds). Grading needs a key with billing enabled for anything beyond light
use; the free tier allows about 15 grading calls a minute. To bound that cost,
each client address can search 20 times a minute; further searches answer
`429` with `retry_after_seconds` until its minute passes. The count is kept in
memory, which suits the single API task.

### Enabling it

1. Run `npm run db:migrate` to create the search tables and indexes.
2. Set `GEMINI_API_KEY` in `server/.env` and restart the API. Get a key from
   Google AI Studio (https://aistudio.google.com/apikey). The API embeds the
   existing scenes in the background and logs how many it embedded.

| Endpoint | Purpose |
| --- | --- |
| `GET /script-scenes/semantic?q=…&tags=…&match=all\|any&limit=20` | The matching scenes, best first; empty when nothing matches. |
| `GET /script-scenes/semantic/status` | Whether semantic search is configured and how much of the library is indexed. |

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
| Semantic search says it isn't available | Run `npm run db:migrate`, set `GEMINI_API_KEY`, then restart the API. |
| App unavailable at `127.0.0.1:5173` | Use `http://localhost:5173`. |
| Wrong Node version | Install Node.js 24.13.1, reopen the terminal, and check your PATH. |