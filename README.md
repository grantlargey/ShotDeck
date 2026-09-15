# ScriptDeck

ScriptDeck is a web app for organizing films, uploading screenplay PDFs, capturing and tagging script scenes, and connecting those scenes to timestamped film stills. Captured text can be edited manually or formatted with an optional AI proposal that the user reviews before accepting.

The project is split into a React/Vite client and an Express/Postgres API. Media files are stored in AWS S3 using presigned upload and view URLs. The repository and some internal identifiers retain the earlier ShotDeck name.

## Project Structure

- `client/` - React app built with Vite and organized with Feature-Sliced Design layers.
- `client/src/app/` - Frontend app entry composition, routing, and global styles.
- `client/src/pages/` - Page slices such as `movies-list`, `movie-detail`, and `script-viewer`.
- `client/src/widgets/` - Reusable app-level UI blocks such as the site header.
- `client/src/features/` - User-action UI that isn't tied to one page, such as the change-password dialog.
- `client/src/entities/` - Domain models and single-entity UI for movies, stills, captured scenes, and the admin session.
- `client/src/shared/` - API operations by backend domain, generic UI primitives, and reusable libraries.
- `server/` - Node.js backend package.
- `server/src/index.js` - Small server entrypoint that imports the app and listens on `PORT`.
- `server/src/app.js` - Express composition root: middleware, CORS, the health check, router mounting, and error middleware.
- `server/src/routes/` - One router per API domain, holding the domain's paths, sign-in guards, and HTTP handlers.
- `server/src/services/` - The domain module behind each router: validation, rules, SQL, and response shaping. `thumbnails.service.js` makes still thumbnails in the background.
- `server/src/repositories/` - Persistence files private to one domain module: admin accounts and sessions, and captured scenes.
- `server/src/db.js`, `server/src/s3.js` - The shared Postgres pool; S3 object keys, uploads, and signed URLs.
- `server/src/config/`, `server/src/middleware/`, `server/src/utils/` - Shared backend support code: CORS, the sign-in guards, the Origin check, the error handler, and small helpers.
- `server/sql/schema.sql` - Postgres schema.
- `package.json` - Root development and database commands.
- `.nvmrc` - Pinned local Node.js version, matching the server Docker image.
- `docker-compose.yml` - Local Postgres and an optional containerized API.
- `infra/` - Deployment utilities.

## Backend Architecture

Each API domain has one router, with one domain module behind it:

```text
HTTP request
  -> app.js: compression, CORS, the Origin check, JSON body parsing
  -> router (routes/<domain>.routes.js): sign-in guard and HTTP handler
  -> domain module (services/<domain>.service.js): validation, rules, SQL, and response shape
  -> Postgres and S3
```

The domains are auth, movies, scripts, captured scenes, stills, uploads, and the AI formatter.

- A router declares its paths with their guards: `requireAdmin` on every route that changes data, and `requireOwner` on account management. Its handlers read the request's parameters, query, and body, call the domain module, and choose the response status. The AI formatter's router parses its own larger JSON body, so `app.js` mounts it before the app-wide parser.
- A domain module is its domain's only interface. It validates one JSON shape for each write, runs the domain's SQL, and shapes responses, including signed S3 view URLs. It reports failures as `HttpError`, which the single error handler in `middleware/error-handler.js` turns into responses. A module that needs another domain's rule imports that domain's module, as scripts and stills do for the movie-existence check in `movies.service.js`.
- When a domain's persistence is large enough for its own file, the file sits in `repositories/` and only its domain module imports it. The admin CLI (`src/admin.js`) goes through the auth module too.
- The migration runner (`src/migrate.js`) owns schema and data migration SQL.

## Frontend Architecture

The frontend follows a lightweight Feature-Sliced Design structure:

```text
app -> pages -> widgets -> features -> entities -> shared
```

In practice:

- `app` wires routing and global application concerns.
- `pages` contain route-level screens and page-local UI.
- `widgets` contain larger reusable UI blocks.
- `features` contain user-action UI that isn't tied to one page, such as the change-password dialog.
- `entities` contain domain models (constants and pure helpers) and the UI that renders one entity, such as a movie or scene card.
- `shared` contains reusable infrastructure: API operations (`shared/api/<domain>.js`), UI primitives (`shared/ui/`), and libraries such as time formatting and the screenplay grammar (`shared/lib/`).

Every operation, helper and component has one owning module, and callers import it directly from that file, for example `import { getMovie } from "@/shared/api/movies.js"` or `import { Button } from "@/shared/ui/Button.jsx"`. There are no `index.js` barrels, re-export files or aggregate API objects, and no modules that only forward calls to another module. A workflow that combines requests, such as uploading a file and then saving the record that points to it, is one operation in its API owner, for example `saveScript` in `shared/api/scripts.js`.

The script-viewer and admin routes are loaded on demand from their page modules, so the PDF renderer and editor are kept out of the initial application bundle.

See the [script viewer architecture guide](docs/architecture/script-viewer.md) for draft ownership, saved text and location rules, and where to change viewer behavior.

## Requirements

- Node.js 24.13.1, pinned in `.nvmrc` and `server/Dockerfile`. With nvm installed, run `nvm install` and `nvm use` from the repository root.
- npm
- Docker Desktop running, or Docker Engine with Compose v2 supporting `up --wait` and `--wait-timeout`
- AWS credentials and S3 settings for media upload features

## Local Development

From the repository root, install the locked dependencies:

```bash
npm ci
npm run setup
```

Create `server/.env` with the environment settings described below. For local development, set `DATABASE_URL=postgres://app:app@127.0.0.1:5432/shotdeck`; Compose overrides the database hostname for its API container. Fill in the server's S3 settings and credentials if you need media features. The frontend defaults to the local API; create `client/.env` only if you need to override its URL.

Start all three development services from the repository root:

```bash
npm run dev
```

This starts the Postgres container, waits up to 60 seconds for its health check, then runs the API with nodemon and the client with Vite on the host. API and client logs share the terminal with `api` and `web` labels. If database startup fails, neither application starts.

The frontend runs on `http://localhost:5173` and the API defaults to `http://localhost:4000`. Vite exits if port `5173` is occupied instead of selecting another port. Both applications reload as their source changes.

Press Ctrl+C to stop the API and client. Postgres stays running between sessions, with data retained in the existing `pgdata` volume. To stop it or inspect its logs:

```bash
npm run db:stop
npm run db:logs
```

Schema changes are applied explicitly using the commands in [Database](#database); `npm run dev` does not run migrations. Apply the schema before using a fresh database.

### Optional Containerized API

To run the API in Docker, stop any host API first, then run:

```bash
docker compose --profile container-api up --build
```

Start the frontend in another terminal:

```bash
npm run dev --prefix client
```

The API container waits for Postgres to become healthy. Its source is copied into the image, so API source changes require rebuilding it. Plain `docker compose up` starts only Postgres; the API requires the `container-api` profile or an explicit service target.

Before returning to `npm run dev`, stop the containerized API with `docker compose --profile container-api stop api` to free port `4000`.

## Environment

The server reads runtime configuration from the shell and `server/.env`. The frontend reads public build-time configuration through Vite. Env files are ignored by Git.

Common settings include:

- `DATABASE_URL` - Postgres connection string.
- `PORT` - API port, defaults to `4000` when unset.
- `AWS_REGION` - AWS region for S3 operations.
- `S3_BUCKET` - Bucket used for covers, scripts, and annotation images.
- `ALLOWED_ORIGINS` - Comma-separated list of additional browser origins allowed by CORS.
- `OPENAI_API_KEY` - Optional, enables AI formatting proposals. Without it, manual editing and PDF capture remain available.
- `OPENAI_SCREENPLAY_MODEL` - Model used for screenplay proposals, defaults to `gpt-5-nano`.
- `OPENAI_SCREENPLAY_TIMEOUT_MS` - Screenplay formatter request timeout in milliseconds, defaults to `90000`.

Admin sign-in needs no configuration: sessions are stored in Postgres and the cookie is marked `Secure` automatically when the API is reached over HTTPS.

The AWS SDK needs credentials in the environment where the API runs. A host's AWS configuration is not automatically available inside the Compose container; supply credentials to that container as appropriate for your setup.

Client configuration:

- `VITE_API_BASE` - Public API base URL, defaults to `http://localhost:4000`.

Restart the Vite dev server after changing client environment files, or rebuild for a deployed frontend. Vite embeds these values in browser assets, so they must not contain secrets.

When running the optional API container, Compose overrides `DATABASE_URL` to use the Postgres service hostname:

```text
postgres://app:app@db:5432/shotdeck
```

When running migration scripts from the host machine against the Compose database, use:

```text
postgres://app:app@127.0.0.1:5432/shotdeck
```

## Database

The schema lives in `server/sql/schema.sql`. Start Postgres and apply it from the repository root:

```bash
npm run db:up
npm run db:migrate
```

The migration script reads `DATABASE_URL` from the shell or `server/.env`; use the local connection string above when targeting the Compose database. It applies the schema and incremental alterations, and imports unmatched legacy script annotations through the shared Postgres pool. It currently has no migration-history ledger, so changes to legacy migration behavior require checking existing database state.

## Admin Access

Reading is public. Every route that creates, changes, or deletes data, plus upload presigning and the AI formatter, requires a signed-in admin. Signed-out visitors get the same pages without any editing controls. Admins sign in at `/login` (the "Admin" link in the footer) and get the full site plus an account menu in the header.

There is no sign-up. Accounts live in `admin_users` with two roles:

- `owner` - created once with the admin CLI. Also manages accounts from the Admins page (account menu, then Manage admins).
- `admin` - created by the owner. Edits content but cannot manage accounts.

Sessions are rows in `admin_sessions`, referenced by an `HttpOnly`, `SameSite=Lax` cookie named `sd_admin` that lasts 30 days and is refreshed on use. Passwords are hashed with Node's built-in scrypt. Sign-in allows 10 failed attempts per email or address per 15 minutes.

Create the owner account after applying the schema:

```bash
npm run admin -- create-owner --email you@example.com
```

The command prompts for a password of at least 12 characters, or reads `ADMIN_PASSWORD` from the environment. Where the database is only reachable from inside the deployment, make the hash locally and pass it instead, so no password leaves your machine:

```bash
npm run admin -- hash
npm run admin -- create-owner --email you@example.com --password-hash '<hash>'
```

`npm run admin -- list` shows the accounts, and `npm run admin -- reset-password --email you@example.com` replaces a password and signs that account out everywhere.

From the Admins page, the owner adds an admin with either a generated temporary password, shown once, which the person must replace at first sign-in, or a password the owner types, which the person keeps. The same page resets passwords and disables or re-enables accounts; disabling signs the account out immediately.

## Available Scripts

From the repository root:

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install locked server and client dependencies after `npm ci` at the root. |
| `npm run dev` | Start Postgres, wait for readiness, and run the API and client locally. |
| `npm run db:up` | Start Postgres and wait for readiness. |
| `npm run db:stop` | Stop Postgres while retaining its data. |
| `npm run db:logs` | Follow Postgres logs. |
| `npm run db:migrate` | Apply the schema and existing migration logic using `DATABASE_URL`. |
| `npm run admin -- <command>` | Manage admin accounts: `hash`, `create-owner`, `reset-password`, `list`. See [Admin Access](#admin-access). |

Client (from `client/`, or append `--prefix client` from the root):

```bash
npm run dev
npm run build
npm run lint
npm test
npm run preview
```

Server (from `server/`, or append `--prefix server` from the root):

```bash
npm run dev
npm test
npm run lint
```

Client tests run with Vitest and jsdom (`npm test --prefix client`); they currently cover the script viewer's scene draft workflow. There is no CI workflow.

### Server tests and lint

`npm test --prefix server` runs the API's tests with `node --test`. They start the Express app on a free port and call it over HTTP, pinning the current HTTP contract of each route, against a throwaway Postgres database:

- The command creates `shotdeck_test_<suffix>` in the running `shotdeck-db-1` container with `docker exec`, applies the schema with `src/migrate.js`, and runs the test files one at a time. It drops the database afterwards, including when tests fail, you press Ctrl+C, or the terminal closes.
- The suffix comes from `TEST_DB_SUFFIX` (lowercase letters, digits and underscores) and defaults to the command's process ID. Runs that happen at the same time need different suffixes. A run refuses to start if its database already exists, and prints the command that drops a leftover one.
- If the container isn't running, the command fails with a message; start Postgres with `npm run db:up`. The command never starts it.
- The command sets `DATABASE_URL`, dummy AWS credentials with S3 sends pointed at a closed local port, and an empty `OPENAI_API_KEY` itself, so a `server/.env` can't point the tests at a real database, bucket or OpenAI key. Presigned URLs are signed locally.

To run part of the suite, pass test files or globs ending in `.js` (relative to `server/`), or `node --test` flags written as `--flag=value`. Each file always runs alone in its own process, so `--test-concurrency` and the test isolation flags are refused:

```bash
TEST_DB_SUFFIX=01 npm test --prefix server -- test/auth.test.js
npm test --prefix server -- --test-name-pattern="signing in"
```

`npm run lint --prefix server` checks the server and its tests with ESLint.

## Local-only Importer

The ShotDeck importer and its compatibility shim are intentionally untracked local tools, so they are not installed by cloning this repository. The public package no longer advertises an importer npm command that depends on those absent files.

An existing local installation containing both `server/src/importShotdeckShots.js` and `server/src/annotation-service.js` can still invoke the CLI directly from `server/`:

```bash
node src/importShotdeckShots.js --help
```

In API mode the importer signs in first with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment (for example from `server/.env.remote`); the account must be an admin, since every write requires one.

Those local files and the repository/S3 helpers they call have been preserved. The importer's deduplication contract still needs to be reconciled with the current annotation API before relying on repeat imports.

## Notes

- Large uploads should go through the app's presigned S3 flow rather than through the API as request bodies.
- The API makes an 800px WebP thumbnail for each film still in a `thumbs/` folder beside the original, in the background: when a still is saved or listed, and at startup for any still without one. Grids, timeline previews, and scene cards use it; the hero and scene viewer keep the full image. Run `npm run db:migrate` after pulling so the `annotations.thumb_key` column exists.
- `npm run db:migrate` also creates the `admin_users` and `admin_sessions` tables; run it before the first sign-in.
- Local env files, data imports, generated task definition snapshots, and local reference notes are ignored by git.
- Production deployment details are intentionally not documented in this public README.
