# ScriptDeck

ScriptDeck is a web app for organizing films, uploading screenplay PDFs, capturing and tagging script scenes, and connecting those scenes to timestamped film stills. Captured text can be edited manually or formatted with an optional AI proposal that the user reviews before accepting.

The project is split into a React/Vite client and an Express/Postgres API. Media files are stored in AWS S3 using presigned upload and view URLs. The repository and some internal identifiers retain the earlier ShotDeck name.

## Project Structure

- `client/` - React app built with Vite and organized with Feature-Sliced Design layers.
- `client/src/app/` - Frontend app entry composition, routing, and global styles.
- `client/src/pages/` - Page slices such as `movies-list`, `movie-detail`, and `script-viewer`.
- `client/src/widgets/` - Reusable app-level UI blocks such as the site header.
- `client/src/features/` - User-action workflows such as movie saves, uploads, annotation writes, and script scene mutations.
- `client/src/entities/` - Business entity helpers for movies, annotations, scripts, and script scenes.
- `client/src/shared/` - Shared API domain clients, upload helpers, generic UI primitives, and reusable libraries.
- `server/` - Node.js backend package.
- `server/src/index.js` - Small server entrypoint that imports the app and listens on `PORT`.
- `server/src/app.js` - Express composition root: middleware, CORS, route mounting, and error middleware.
- `server/src/routes/` - Public API route declarations.
- `server/src/controllers/` - Express request/response handlers.
- `server/src/services/` - Business rules, transactions, and orchestration.
- `server/src/repositories/` - SQL queries and database persistence boundaries.
- `server/src/serializers/` - API response shaping, including signed S3 view URLs.
- `server/src/config/`, `server/src/middleware/`, `server/src/utils/` - Shared backend support code.
- `server/sql/schema.sql` - Postgres schema.
- `docker-compose.yml` - Local Postgres and API services.
- `infra/` - Deployment utilities.

## Backend Architecture

The backend follows a route/controller/service/repository structure:

```text
HTTP request
  -> route
  -> controller
  -> service
  -> repository
  -> Postgres
```

The layers have separate responsibilities:

- Routes define URL paths and HTTP methods.
- Controllers translate Express `req`/`res` into service calls and HTTP responses.
- Services own application rules, such as validation decisions, overlap checks, transactions, and S3 orchestration.
- Repositories own application queries. Services issue transaction commands, and the migration runner owns schema/data migration SQL.
- Serializers convert database rows into API response shapes expected by the frontend.

This keeps `index.js` readable and makes the backend easier to change without hunting through one large file.

## Frontend Architecture

The frontend follows a lightweight Feature-Sliced Design structure:

```text
app -> pages -> widgets -> features -> entities -> shared
```

In practice:

- `app` wires routing and global application concerns.
- `pages` contain route-level screens and page-local UI.
- `widgets` contain larger reusable UI blocks.
- `features` contain reusable user actions that combine API calls and upload steps.
- `entities` contain business-domain constants and pure helpers.
- `shared` contains reusable infrastructure such as domain API clients, uploads, UI primitives, and time formatting.

Each page slice exposes a small public API through its `index.js` file. Higher layers import from those public APIs rather than reaching into another slice's internal `ui` files.

The script-viewer route is loaded on demand so the PDF renderer and editor are kept out of the initial application bundle.

## Requirements

- Node.js compatible with the installed Vite toolchain: `^20.19.0 || >=22.12.0`. Use a maintained Node release; the cleanup checks were run on Node 24.
- npm
- Docker Desktop, if using the local Postgres container
- AWS credentials and S3 settings for media upload features

## Local Development

From the repository root, install the locked dependencies:

```bash
npm ci --prefix client
npm ci --prefix server
```

Create `server/.env` with the environment settings described below. For local development, set `DATABASE_URL=postgres://app:app@127.0.0.1:5432/shotdeck`; Compose overrides the database hostname for its API container. Fill in the server's S3 settings and credentials if you need media features. The frontend defaults to the local API; create `client/.env` only if you need to override its URL.

Start Postgres and the API from the repository root:

```bash
docker compose up --build
```

In another terminal, apply the database schema to the local Compose database:

```bash
DATABASE_URL=postgres://app:app@127.0.0.1:5432/shotdeck node server/src/migrate.js
```

Alternatively, start only Postgres and run the API directly on the host:

```bash
docker compose up -d db
npm run dev --prefix server
```

Start the frontend:

```bash
npm run dev --prefix client
```

By default, the frontend runs on `http://localhost:5173` and the API listens on port `4000`.

## Environment

The server reads runtime configuration from the shell and `server/.env`. The frontend reads public build-time configuration through Vite. Env files are ignored by Git.

Common settings include:

- `DATABASE_URL` - Postgres connection string.
- `PORT` - API port, defaults to `4000` when unset.
- `AWS_REGION` - AWS region for S3 operations.
- `S3_BUCKET` - Bucket used for covers, scripts, and annotation images.
- `ALLOWED_ORIGINS` - Comma-separated list of additional browser origins allowed by CORS.
- `OPENAI_API_KEY` - Optional, enables AI formatting proposals. Without it, manual editing and PDF capture remain available.
- `OPENAI_SCREENPLAY_MODEL` - Model used for screenplay proposals; falls back to `OPENAI_FORMAT_MODEL`, then `gpt-5-nano`.
- `OPENAI_SCREENPLAY_TIMEOUT_MS` - Screenplay formatter request timeout in milliseconds, defaults to `90000`.
- `OPENAI_FORMAT_MODEL` - Model for the retained annotation-format endpoint, defaults to `gpt-5-nano`; also a fallback for screenplay formatting.
- `OPENAI_FORMAT_TIMEOUT_MS` - Retained annotation formatter request timeout, defaults to `10000`.

The AWS SDK needs credentials in the environment where the API runs. A host's AWS configuration is not automatically available inside the Compose container; supply credentials to that container as appropriate for your setup.

Client configuration:

- `VITE_API_BASE` - Public API base URL, defaults to `http://localhost:4000`.
- `VITE_API_URL` - Retained fallback alias used only when `VITE_API_BASE` is unset or empty. Prefer `VITE_API_BASE` for new configurations.

Restart the Vite dev server after changing client environment files, or rebuild for a deployed frontend. Vite embeds these values in browser assets, so they must not contain secrets.

When running with `docker-compose.yml`, the API service uses the Compose Postgres host:

```text
postgres://app:app@db:5432/shotdeck
```

When running migration scripts from the host machine against the Compose database, use:

```text
postgres://app:app@127.0.0.1:5432/shotdeck
```

## Database

The schema lives in `server/sql/schema.sql`. Apply it with:

```bash
cd server
node src/migrate.js
```

The migration script reads `DATABASE_URL`, applies the schema and incremental alterations, and imports unmatched legacy script annotations through the shared Postgres pool. It currently has no migration-history ledger, so changes to legacy migration behavior require checking existing database state.

## Available Scripts

Client:

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

Server:

```bash
npm run dev
```

The server's `test` script is still an unimplemented placeholder. There is no tracked automated test suite or CI workflow yet.

## Local-only Importer

The ShotDeck importer and its compatibility shim are intentionally untracked local tools, so they are not installed by cloning this repository. The public package no longer advertises an importer npm command that depends on those absent files.

An existing local installation containing both `server/src/importShotdeckShots.js` and `server/src/annotation-service.js` can still invoke the CLI directly from `server/`:

```bash
node src/importShotdeckShots.js --help
```

Those local files and the repository/S3 helpers they call have been preserved. The importer's deduplication contract still needs to be reconciled with the current annotation API before relying on repeat imports.

## Notes

- Large uploads should go through the app's presigned S3 flow rather than through the API as request bodies.
- Local env files, data imports, generated task definition snapshots, and local reference notes are ignored by git.
- Production deployment details are intentionally not documented in this public README.
