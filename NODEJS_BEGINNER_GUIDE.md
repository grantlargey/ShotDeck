# Beginner-Friendly Node.js Guide for ShotDeck

This guide explains Node.js using this project as the example. It assumes you are new to backend work and starts with the basics before connecting those ideas to the current ShotDeck architecture.

## What Node.js Is

JavaScript usually runs in the browser. Node.js lets JavaScript run outside the browser, which means JavaScript can power:

- backend servers
- database scripts
- command-line tools
- file-system work
- API integrations
- frontend build tools

Plain English summary: Node.js is what lets ShotDeck use JavaScript for server-side work, not just browser UI work.

## Where Node.js Appears In This Project

### API server

The backend starts in [server/src/index.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/index.js). That file is intentionally small: it imports the Express app and starts listening on a port.

The actual Express app is assembled in [server/src/app.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/app.js). It adds CORS, JSON parsing, route modules, and error handling.

### Environment configuration

Environment loading lives in [server/src/env.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/env.js). Environment variables configure things that should not be hard-coded:

- `PORT`
- `DATABASE_URL`
- `AWS_REGION`
- `S3_BUCKET`
- `OPENAI_API_KEY`
- `ALLOWED_ORIGINS`

### Database access

Database connection setup lives in [server/src/db.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/db.js). It creates a Postgres connection pool using the `pg` package.

A pool is a reusable set of database connections. Instead of opening a new connection for every request, the backend reuses existing connections.

### S3 helpers

S3 helper code lives in [server/src/s3.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/s3.js). It creates presigned upload URLs, presigned view URLs, and safe object keys.

Presigned URLs let the browser upload files directly to S3 without sending large files through Express.

### Database migration script

The migration script is [server/src/migrate.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/migrate.js). It is a Node.js command-line script, not a web server. It applies [server/sql/schema.sql](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/sql/schema.sql) to the configured database.

### Importer CLI

The importer is [server/src/importShotdeckShots.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/importShotdeckShots.js). It is another Node.js command-line program. It can import ShotDeck data by talking to the API or by using direct database/S3 access.

### Frontend tooling

React runs in the browser, but Vite runs on Node.js during development and builds. When you run `npm run dev` in `client/`, Node.js starts the Vite development server.

## Current Backend Shape

ShotDeck's backend now uses a layered structure:

```text
server/src/
  index.js
  app.js
  routes/
  controllers/
  services/
  repositories/
  serializers/
  config/
  middleware/
  utils/
```

The request flow is:

```text
browser fetch()
  -> Express route
  -> controller
  -> service
  -> repository
  -> Postgres
```

Then the response flows back through serializers/controllers as JSON.

### Routes

Routes live in [server/src/routes](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/routes). They define public API paths such as:

- `GET /health`
- `GET /movies`
- `POST /movies`
- `POST /uploads/presign`
- `GET /script-scenes`

Plain English summary: routes are the named doors into the backend.

### Controllers

Controllers live in [server/src/controllers](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/controllers). They read Express request data, call services, choose status codes, and return JSON.

Plain English summary: controllers translate HTTP into application work.

### Services

Services live in [server/src/services](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/services). They contain business rules and orchestration. Examples:

- preserving a movie's existing cover key when an update omits it
- checking that script scene time ranges do not overlap
- creating an anchor row and scene annotation row in one transaction
- creating S3 presigned upload metadata
- gracefully falling back when OpenAI formatting is unavailable

Plain English summary: services decide what the app should do.

### Repositories

Repositories live in [server/src/repositories](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/repositories). They contain SQL and return database rows.

Plain English summary: repositories are the database boundary.

### Serializers

Serializers live in [server/src/serializers](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/serializers). They convert database rows into API shapes the frontend expects. They also attach signed view URLs for covers, scripts, and annotation images.

Plain English summary: serializers shape data before it leaves the backend.

## What Happens When The Frontend Calls The Backend

Example: loading movies.

1. React calls `api.listMovies()` through the shared API client in [client/src/shared/api/client.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/client/src/shared/api/client.js).
2. The helper sends `GET /movies` to the API base URL.
3. [server/src/routes/movies.routes.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/routes/movies.routes.js) matches the route.
4. [server/src/controllers/movies.controller.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/controllers/movies.controller.js) calls the movie service.
5. [server/src/services/movies.service.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/services/movies.service.js) asks the repository for movies.
6. [server/src/repositories/movies.repository.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/repositories/movies.repository.js) runs SQL through the Postgres pool.
7. [server/src/serializers/movies.serializer.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/serializers/movies.serializer.js) adds signed cover URLs when needed.
8. The controller returns JSON to the browser.

Plain English summary: the frontend asks, the backend validates and coordinates, Postgres stores data, and the browser renders the result.

## Node.js Fundamentals You Should Understand

### Modules and imports

A module is a file that exports code so another file can import it. This project uses ES modules because [server/package.json](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/package.json) sets `"type": "module"`.

That is why backend files use:

```js
import { pool } from "./db.js";
export function example() {}
```

### Async/await

`async` and `await` make asynchronous work readable. ShotDeck uses `await` for:

- database queries
- S3 presigned URLs
- OpenAI API calls
- file-system work in importer scripts

Node.js is strong at I/O-heavy work because it can wait on databases and network services without blocking the whole process.

### HTTP and JSON

The browser and backend mostly communicate with JSON. Express parses JSON request bodies through `express.json(...)` in [server/src/app.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/app.js), and controllers return JSON with `res.json(...)`.

### Middleware

Middleware is code that runs as part of the Express request pipeline. ShotDeck uses middleware for:

- CORS
- JSON body parsing
- final error handling

### Connection pooling

[server/src/db.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/db.js) creates one shared `pg.Pool`. That is a professional backend pattern because it avoids scattering database connection setup throughout the app.

### Transactions

A transaction is a group of database operations that should succeed or fail together. Script scene creation and updates use transactions because they modify related anchor and annotation rows.

The pattern is:

```text
BEGIN
do multiple queries
COMMIT if all succeed
ROLLBACK if anything fails
```

### Environment variables

`process.env` is how Node.js reads runtime configuration. This keeps secrets and environment-specific values out of source code.

## Node.js vs Express vs pg vs Vite

- Node.js is the runtime that runs JavaScript outside the browser.
- Express is the web framework that handles routes, middleware, requests, and responses.
- `pg` is the Postgres driver used by the backend.
- Vite is the frontend dev/build tool that runs on Node.js but serves React code for the browser.

## Useful Commands

Start the Dockerized database and API:

```bash
docker compose up --build
```

Apply the schema to the Compose database from the host:

```bash
cd server
DATABASE_URL=postgres://app:app@127.0.0.1:5432/shotdeck node src/migrate.js
```

Start the backend directly:

```bash
cd server
npm run dev
```

Start the frontend:

```bash
cd client
npm run dev
```

## Interview Cheat Sheet

### What is Node.js in this project?

Node.js is the runtime for the Express API, database migration script, importer CLI, and frontend tooling.

### What did you build with Node.js?

A modular Express backend with routes, controllers, services, repositories, serializers, Postgres access, S3 presigned uploads, OpenAI-backed annotation formatting, and CLI scripts.

### What backend fundamentals did you use?

ES modules, environment variables, async/await, non-blocking I/O, HTTP routing, JSON APIs, middleware, connection pooling, SQL repositories, transactions, and direct-to-S3 uploads.

### What is the difference between Node.js and Express?

Node.js runs JavaScript on the server. Express is a library running on Node.js that makes HTTP server code easier to organize.

## Final Takeaway

Node.js is the runtime that lets ShotDeck use JavaScript for backend and tooling work. Express organizes HTTP, Postgres stores structured data, S3 stores files, and React/Vite power the frontend experience.
