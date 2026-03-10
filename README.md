# ShotDeck Annotator

## Production Deploy

Use the reusable deploy script at [infra/deploy-prod.sh](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/infra/deploy-prod.sh). It handles:

- building the backend image from a clean temp context so local env files are not baked into Docker
- pushing the backend image to ECR
- updating the ECS task definition and service while preserving the currently deployed ECS runtime env
- verifying a DB-backed backend smoke endpoint, not just `/health`
- automatically rolling the backend back to the previous ECS task definition if backend verification fails
- building the frontend
- syncing the frontend build to the production S3 bucket used by CloudFront
- verifying backend health and frontend `index.html`
- optionally invalidating the CloudFront distribution after a frontend deploy

### Prerequisites

- AWS CLI is authenticated for the production account
- Docker Desktop is running

### Deploy Both Backend And Frontend

```bash
cd /Users/grantlargey/Desktop/ShotDeck/ShotDeck
bash infra/deploy-prod.sh \
  --api-health-url https://api.scriptdeckdemo.com/health \
  --api-smoke-url https://api.scriptdeckdemo.com/movies \
  --frontend-api-base https://api.scriptdeckdemo.com \
  --cloudfront-distribution-id <DIST_ID>
```

### Deploy Backend Only

```bash
cd /Users/grantlargey/Desktop/ShotDeck/ShotDeck
bash infra/deploy-prod.sh \
  --backend-only \
  --api-health-url https://api.scriptdeckdemo.com/health \
  --api-smoke-url https://api.scriptdeckdemo.com/movies
```

### Deploy Frontend Only

```bash
cd /Users/grantlargey/Desktop/ShotDeck/ShotDeck
bash infra/deploy-prod.sh \
  --frontend-only \
  --frontend-api-base https://api.scriptdeckdemo.com \
  --cloudfront-distribution-id <DIST_ID>
```

### Useful Overrides

```bash
cd /Users/grantlargey/Desktop/ShotDeck/ShotDeck
bash infra/deploy-prod.sh --image-tag my-custom-tag --skip-verify
```

```bash
cd /Users/grantlargey/Desktop/ShotDeck/ShotDeck
bash infra/deploy-prod.sh \
  --frontend-only \
  --frontend-api-base https://api.scriptdeckdemo.com \
  --cloudfront-distribution-id <DIST_ID> \
  --skip-verify
```

The script defaults to this project's current production targets:

- region: `us-east-1`
- ECR repo: `shotdeck-api`
- ECS cluster: `shotdeck-prod2`
- ECS service: `shotdeck-api-service-hf9lczwr`
- frontend bucket: `shotdeck-frontend-grop`
- frontend API base: `https://api.scriptdeckdemo.com`
- API health URL: `https://api.scriptdeckdemo.com/health`
- API smoke URL: `https://api.scriptdeckdemo.com/movies`

Important:

- the deploy script uses the ECS service's current task definition as its base
- it does not copy local [server/.env](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/.env) values into production
- it refuses to deploy from a base task definition whose `DATABASE_URL` points at `localhost` or `127.0.0.1`, unless you explicitly override that
- backend deploys verify both `/health` and a DB-backed smoke endpoint before being considered successful
- if the new backend revision fails verification, the script rolls ECS back to the previous task definition automatically
- frontend deploys assume the public site is served by CloudFront in front of `shotdeck-frontend-grop`
- frontend deploys upload `index.html` with no-cache headers, hashed assets with immutable caching, and no longer rely on S3 website `404.html`
- the media bucket used for covers, annotation images, and scripts must allow CORS for `https://scriptdeckdemo.com`, `https://www.scriptdeckdemo.com`, and local dev origins because uploads and PDF viewing still use presigned S3 URLs
- if you need to change production env vars or secrets, do that intentionally in ECS/infra instead of relying on the deploy script

### Reusable Codex Prompt

Use this in future chats:

```text
You are working in my ShotDeck repo.

Use the existing deploy script at infra/deploy-prod.sh. Do not invent a new deploy flow.

Task:
1. Inspect git diff/status and summarize what will be deployed.
2. Run the appropriate deploy command:
   - both: bash infra/deploy-prod.sh
   - backend only: bash infra/deploy-prod.sh --backend-only
   - frontend only: bash infra/deploy-prod.sh --frontend-only --frontend-api-base https://api.scriptdeckdemo.com --cloudfront-distribution-id <DIST_ID>
3. Verify:
   - backend health URL responds successfully
   - backend smoke URL responds successfully and returns valid JSON
   - frontend index.html is present with no-cache headers
   - the CloudFront-served site loads and deep links work
4. Report:
   - deployed image tag / ECS task definition
   - whether backend and frontend verification passed
   - any rollback risk or follow-up needed

Important:
- use the repo's real deploy script, not ad hoc commands
- do not bake server/.env into a Docker image
- preserve the current ECS runtime env unless I explicitly ask to change it
- use `https://api.scriptdeckdemo.com` for production verification and frontend builds
- include the CloudFront distribution ID when deploying the frontend so the CDN is invalidated
- if backend verification fails, rollback to the previous ECS task definition
- if the deploy fails, stop and explain the failure clearly
```

## ShotDeck Importer

The one-off importer lives at [server/src/importShotdeckShots.js](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/src/importShotdeckShots.js). It uses the app's real backend path:

- uploads annotation images to the same S3 `annotations/<movieId>/...` namespace the app already uses
- creates rows in the `annotations` table through shared server-side annotation logic
- stores timestamps in `annotations.time_seconds`
- can run in `api` mode against the deployed backend or `db` mode against a reachable database/S3 environment
- can auto-fill missing `shotTime` values from a companion `shotdeck-shot-times.csv` by matching row order or filename

The importer is designed for movie folders placed under `data/sd/<MovieFolder>` or `data/shotdeck/<MovieFolder>`. It can:

- auto-select the only dataset folder when just one exists
- accept `--dataset <MovieFolder>` when multiple folders exist
- accept `--data-dir <path>` if you want full control
- auto-detect the best primary CSV in the folder
- auto-detect a companion timing CSV when the primary CSV is missing `shotTime`

### Prerequisites

- For `api` mode, set `API_BASE` directly or source `server/.env.remote`.
- For `db` mode, `server/.env` must point at the real Postgres database and S3 bucket.
- If `server/.env` points to local Postgres, plain `npm run import:shotdeck ...` will use local `db` mode. For deployed imports, source `server/.env.remote` or pass `--mode api --api-base <url>`.
- Use the movie UUID from your app URL, for example `/movies/<movie-id>`.
- Put the movie assets in a folder like `data/sd/Joker/` with the JPGs and CSVs.

### Dry Run

From [server/package.json](/Users/grantlargey/Desktop/ShotDeck/ShotDeck/server/package.json):

```bash
cd server
npm run import:shotdeck -- --movie-id <movie-id> --dataset <MovieFolder> --dry-run
```

If `API_BASE` is set in your environment, the importer auto-selects `api` mode and talks to the deployed backend. Otherwise it uses `db` mode and talks directly to Postgres/S3. Dry run validates the CSV, matches JPGs, checks for existing annotations, and prints what would be created or updated without uploading files or writing database rows.

### Remote Dry Run via `.env.remote`

```bash
cd server
( set -a; source .env.remote; set +a; npm run import:shotdeck -- --movie-id <movie-id> --dataset <MovieFolder> --limit 5 --dry-run )
```

### Import First 5

```bash
cd server
npm run import:shotdeck -- --movie-id <movie-id> --dataset <MovieFolder> --limit 5
```

### Remote Import First 5

```bash
cd server
( set -a; source .env.remote; set +a; npm run import:shotdeck -- --movie-id <movie-id> --dataset <MovieFolder> --limit 5 )
```

### Import All Rows

```bash
cd server
npm run import:shotdeck -- --movie-id <movie-id> --dataset <MovieFolder>
```

### Remote Import All Rows

```bash
cd server
( set -a; source .env.remote; set +a; npm run import:shotdeck -- --movie-id <movie-id> --dataset <MovieFolder> )
```

### Optional Explicit Dataset Path

If you want to point at a specific directory:

```bash
cd server
npm run import:shotdeck -- --movie-id <movie-id> --data-dir ../data/sd/Joker
```

Remote example:

```bash
cd server
( set -a; source .env.remote; set +a; npm run import:shotdeck -- --movie-id <movie-id> --data-dir ../data/sd/Joker )
```

### Import Behavior

- Each CSV row is matched to a local image by `downloadedFileName` first.
- If that misses, the importer falls back to `filename` and then a suffix match like `001_small_*.jpg`.
- If the primary CSV is missing `shotTime`, the importer will fill it from another CSV in the same directory with a `shotTime` column, or from `--time-csv`.
- Annotation `title` is the exact matched JPG filename.
- Annotation `body` is the exact matched JPG filename.
- Annotation `time_seconds` is parsed from `shotTime`.
- Existing annotations are detected by `movie_id + time_seconds + title + body` so reruns skip obvious duplicates.
- If a matching annotation already exists but has no `image_key`, the importer uploads the JPG and attaches it instead of creating a second row.
- Rows with a blank or invalid `shotTime` are logged as failures because `annotations.time_seconds` is required.
- Successes, skips, updates, failures, and a final summary are logged to stdout.

### Folder Expectations

- Put one movie per folder under `data/sd` or `data/shotdeck`.
- Include the JPGs you want to import.
- Include at least one CSV with image identifiers such as `downloadedFileName` or `filename`.
- If that CSV does not contain `shotTime`, include a second CSV with `shotTime` plus matching `order` or `downloadedFileName`.

### Modes

- `api` mode uses `API_BASE` or `--api-base` and reuses the deployed app's real `/uploads/presign` plus `/movies/:id/annotations` endpoints. This is the right choice when the database is private.
- `db` mode uses `DATABASE_URL`, `AWS_REGION`, and `S3_BUCKET` directly. This is useful for local development or private environments where you can reach Postgres and S3 from the machine running the importer.
