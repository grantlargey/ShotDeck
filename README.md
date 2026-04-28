# ShotDeck Annotator

ShotDeck Annotator is a web app for organizing films, uploading scripts, and attaching timestamped annotations, links, images, and script references to movie moments.

The project is split into a React/Vite client and an Express/Postgres API. Media files are stored through S3-compatible object storage using presigned upload and view URLs.

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

The backend now follows a route/controller/service/repository structure:

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
- Repositories are the only layer that should contain SQL.
- Serializers convert database rows into API response shapes expected by the frontend.

This keeps `index.js` readable and makes the backend easier to change without hunting through one large file.

## Frontend Architecture

The frontend now follows a lightweight Feature-Sliced Design structure:

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

## Requirements

- Node.js
- npm
- Docker Desktop, if using the local Postgres container
- AWS credentials and S3 settings for media upload features

## Local Development

Install dependencies:

```bash
cd client
npm install

cd ../server
npm install
```

Start Postgres and the API with Docker Compose:

```bash
docker compose up --build
```

Apply the database schema to the local Compose database:

```bash
cd server
DATABASE_URL=postgres://app:app@127.0.0.1:5432/shotdeck node src/migrate.js
```

Or run the API directly during development:

```bash
cd server
npm run dev
```

Start the frontend:

```bash
cd client
npm run dev
```

By default, the frontend runs on `http://localhost:5173` and the API listens on port `4000`.

## Environment

The server expects runtime configuration through environment variables. For local development, create `server/.env`; env files are intentionally ignored by git.

Common settings include:

- `DATABASE_URL` - Postgres connection string.
- `PORT` - API port, defaults to `4000` when unset.
- `AWS_REGION` - AWS region for S3 operations.
- `S3_BUCKET` - Bucket used for covers, scripts, and annotation images.
- `ALLOWED_ORIGINS` - Comma-separated list of additional browser origins allowed by CORS.
- `OPENAI_API_KEY` - Optional, enables annotation text formatting.
- `OPENAI_FORMAT_MODEL` - Optional model override for annotation formatting.

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

The migration script reads `DATABASE_URL`, loads the SQL schema, and applies it through the shared Postgres pool.

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
npm run import:shotdeck
```

## Notes

- Large uploads should go through the app's presigned S3 flow rather than through the API as request bodies.
- Local env files, private learning notes, data imports, generated task definition snapshots, and Codex-only notes are ignored by git.
- `server/BACKEND_LEARNING_GUIDE.md` is intentionally private and ignored by git.
- `client/FRONTEND_LEARNING_GUIDE.md` is intentionally private and ignored by git.
- Production deployment details are intentionally not documented in this public README.
