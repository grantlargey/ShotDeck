#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: bash infra/deploy-prod.sh [options]

Options:
  --backend-only        Deploy only the ECS backend
  --frontend-only       Deploy only the S3 frontend
  --skip-verify         Skip post-deploy health and website checks
  --no-rollback         Do not auto-rollback backend on failed verification
  --skip-migrations     Deploy the backend without running database migrations first
  --allow-local-database
                       Allow a localhost/127.0.0.1 DATABASE_URL in the base ECS task definition
  --region REGION       AWS region override
  --account-id ID       AWS account ID override
  --ecr-repo NAME       ECR repository override
  --ecs-cluster NAME    ECS cluster override
  --ecs-service NAME    ECS service override
  --frontend-bucket B   Frontend S3 bucket override
  --frontend-api-base U Frontend API base URL override
  --cloudfront-distribution-id ID
                       CloudFront distribution to invalidate after frontend deploy
  --api-health-url URL  API health URL override
  --api-smoke-url URL   Backend smoke-test URL override
  --image-tag TAG       Docker image tag override
  -h, --help            Show this help
EOF
}

deploy_backend=1
deploy_frontend=1
skip_verify=0
auto_rollback=1
run_migrations=1
allow_local_database=0

DEPLOY_REGION=""
AWS_ACCOUNT_ID_OVERRIDE=""
ECR_REPO_OVERRIDE=""
ECS_CLUSTER_OVERRIDE=""
ECS_SERVICE_OVERRIDE=""
FRONTEND_BUCKET_OVERRIDE=""
FRONTEND_API_BASE_OVERRIDE=""
CLOUDFRONT_DISTRIBUTION_ID_OVERRIDE=""
API_HEALTH_URL_OVERRIDE=""
API_SMOKE_URL_OVERRIDE=""
IMAGE_TAG_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only)
      deploy_frontend=0
      shift
      ;;
    --frontend-only)
      deploy_backend=0
      shift
      ;;
    --skip-verify)
      skip_verify=1
      shift
      ;;
    --no-rollback)
      auto_rollback=0
      shift
      ;;
    --skip-migrations)
      run_migrations=0
      shift
      ;;
    --allow-local-database)
      allow_local_database=1
      shift
      ;;
    --region)
      DEPLOY_REGION="${2:-}"
      shift 2
      ;;
    --account-id)
      AWS_ACCOUNT_ID_OVERRIDE="${2:-}"
      shift 2
      ;;
    --ecr-repo)
      ECR_REPO_OVERRIDE="${2:-}"
      shift 2
      ;;
    --ecs-cluster)
      ECS_CLUSTER_OVERRIDE="${2:-}"
      shift 2
      ;;
    --ecs-service)
      ECS_SERVICE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --frontend-bucket)
      FRONTEND_BUCKET_OVERRIDE="${2:-}"
      shift 2
      ;;
    --frontend-api-base)
      FRONTEND_API_BASE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --cloudfront-distribution-id)
      CLOUDFRONT_DISTRIBUTION_ID_OVERRIDE="${2:-}"
      shift 2
      ;;
    --api-health-url)
      API_HEALTH_URL_OVERRIDE="${2:-}"
      shift 2
      ;;
    --api-smoke-url)
      API_SMOKE_URL_OVERRIDE="${2:-}"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG_OVERRIDE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd aws
require_cmd python3
require_cmd rsync
require_cmd npm

if [[ "$deploy_backend" -eq 1 ]]; then
  require_cmd docker
fi

AWS_REGION="${DEPLOY_REGION:-${AWS_REGION:-us-east-1}}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID_OVERRIDE:-718484332261}"
ECR_REPO="${ECR_REPO_OVERRIDE:-shotdeck-api}"
ECS_CLUSTER="${ECS_CLUSTER_OVERRIDE:-shotdeck-prod2}"
ECS_SERVICE="${ECS_SERVICE_OVERRIDE:-shotdeck-api-service-hf9lczwr}"
FRONTEND_BUCKET="${FRONTEND_BUCKET_OVERRIDE:-shotdeck-frontend-grop}"
FRONTEND_API_BASE="${FRONTEND_API_BASE_OVERRIDE:-https://api.scriptdeckdemo.com}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID_OVERRIDE:-}"
API_HEALTH_URL="${API_HEALTH_URL_OVERRIDE:-https://api.scriptdeckdemo.com/health}"
API_SMOKE_URL="${API_SMOKE_URL_OVERRIDE:-https://api.scriptdeckdemo.com/movies}"
IMAGE_TAG="${IMAGE_TAG_OVERRIDE:-deploy-amd64-$(date +%Y%m%d%H%M%S)}"
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"

export AWS_REGION

rollback_backend() {
  local rollback_td="$1"
  if [[ -z "$rollback_td" ]]; then
    echo "[ERROR] No rollback task definition available" >&2
    return 1
  fi

  echo "[WARN] Rolling backend back to $rollback_td"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "$rollback_td" \
    --region "$AWS_REGION" >/dev/null

  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION"

  echo "[WARN] Rollback completed: $rollback_td"
}

# Runs `node src/migrate.js` once as a standalone task on the new task
# definition, in the service's own subnets and security groups, so schema
# changes land before any new API task starts. Migrations must stay backward
# compatible with the previous release: it keeps serving until the service
# update finishes, and it is what auto-rollback returns to.
run_migrations_task() {
  local task_definition="$1"
  local task_definition_json="$2"
  local service_json="/tmp/shotdeck-service.json"
  local network_json="/tmp/shotdeck-migrate-network.json"
  local capacity_json="/tmp/shotdeck-migrate-capacity.json"
  local settings_txt="/tmp/shotdeck-migrate-settings.txt"
  local run_json="/tmp/shotdeck-migrate-run.json"
  local logs_json="/tmp/shotdeck-migrate-logs.json"

  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION" \
    --query 'services[0]' > "$service_json" || return 1

  python3 - <<'PY' "$service_json" "$task_definition_json" "$network_json" "$capacity_json" "$settings_txt" || return 1
import json
import sys

service_path, task_path, network_path, capacity_path, settings_path = sys.argv[1:6]

with open(service_path, "r", encoding="utf-8") as fh:
    service = json.load(fh)
with open(task_path, "r", encoding="utf-8") as fh:
    task = json.load(fh)

network = service.get("networkConfiguration")
if not network:
    raise SystemExit("Service has no network configuration to run the migration task in.")
with open(network_path, "w", encoding="utf-8") as fh:
    json.dump(network, fh)

launch_type = service.get("launchType") or ""
capacity = service.get("capacityProviderStrategy") or []
if not launch_type and not capacity:
    raise SystemExit("Service has neither a launch type nor a capacity provider strategy.")
with open(capacity_path, "w", encoding="utf-8") as fh:
    json.dump(capacity, fh)

api = next((c for c in task.get("containerDefinitions", []) if c.get("name") == "api"), {})
log_options = (api.get("logConfiguration") or {}).get("options") or {}

with open(settings_path, "w", encoding="utf-8") as fh:
    fh.write(f"{launch_type}\n{log_options.get('awslogs-group', '')}\n{log_options.get('awslogs-stream-prefix', '')}\n")
PY

  local launch_type log_group log_prefix
  launch_type="$(sed -n 1p "$settings_txt")"
  log_group="$(sed -n 2p "$settings_txt")"
  log_prefix="$(sed -n 3p "$settings_txt")"

  local placement_flag placement_value
  if [[ -n "$launch_type" ]]; then
    placement_flag="--launch-type"
    placement_value="$launch_type"
  else
    placement_flag="--capacity-provider-strategy"
    placement_value="file://$capacity_json"
  fi

  echo "[INFO] Starting migration task on $task_definition"
  aws ecs run-task \
    --cluster "$ECS_CLUSTER" \
    --task-definition "$task_definition" \
    "$placement_flag" "$placement_value" \
    --network-configuration "file://$network_json" \
    --overrides '{"containerOverrides":[{"name":"api","command":["node","src/migrate.js"]}]}' \
    --started-by "deploy-prod-migrate" \
    --region "$AWS_REGION" \
    --output json > "$run_json" || return 1

  python3 - <<'PY' "$run_json" "$settings_txt" || return 1
import json
import sys

run_path, settings_path = sys.argv[1:3]

with open(run_path, "r", encoding="utf-8") as fh:
    result = json.load(fh)

failures = result.get("failures") or []
for failure in failures:
    print(f"[ERROR] RunTask failure: {failure.get('reason')} {failure.get('detail') or ''}", file=sys.stderr)
tasks = result.get("tasks") or []
if failures or not tasks:
    raise SystemExit("RunTask did not start the migration task.")

with open(settings_path, "a", encoding="utf-8") as fh:
    fh.write(tasks[0]["taskArn"] + "\n")
PY

  local task_arn task_id
  task_arn="$(sed -n 4p "$settings_txt")"
  task_id="${task_arn##*/}"

  echo "[INFO] Waiting for migration task $task_id to finish"
  if ! aws ecs wait tasks-stopped \
    --cluster "$ECS_CLUSTER" \
    --tasks "$task_arn" \
    --region "$AWS_REGION"; then
    echo "[ERROR] Timed out waiting for migration task $task_arn" >&2
    return 1
  fi

  local exit_code stopped_reason
  exit_code="$(aws ecs describe-tasks \
    --cluster "$ECS_CLUSTER" \
    --tasks "$task_arn" \
    --region "$AWS_REGION" \
    --query "tasks[0].containers[?name=='api'] | [0].exitCode" \
    --output text)" || return 1
  stopped_reason="$(aws ecs describe-tasks \
    --cluster "$ECS_CLUSTER" \
    --tasks "$task_arn" \
    --region "$AWS_REGION" \
    --query 'tasks[0].stoppedReason' \
    --output text)" || return 1

  # CloudWatch can lag a few seconds behind a task that just stopped.
  if [[ -n "$log_group" && -n "$log_prefix" ]]; then
    local attempt logs_printed=0
    for attempt in 1 2 3; do
      if aws logs get-log-events \
        --log-group-name "$log_group" \
        --log-stream-name "$log_prefix/api/$task_id" \
        --start-from-head \
        --region "$AWS_REGION" \
        --output json > "$logs_json" 2>/dev/null \
        && python3 -c 'import json, sys; sys.exit(0 if json.load(open(sys.argv[1]))["events"] else 1)' "$logs_json"; then
        python3 -c 'import json, sys; [print("  | " + e["message"]) for e in json.load(open(sys.argv[1]))["events"]]' "$logs_json"
        logs_printed=1
        break
      fi
      sleep 5
    done
    if [[ "$logs_printed" -eq 0 ]]; then
      echo "[WARN] Could not read migration logs from $log_group ($log_prefix/api/$task_id); check logs:GetLogEvents access. The exit code below still decides the deploy."
    fi
  fi

  if [[ "$exit_code" != "0" ]]; then
    echo "[ERROR] Migration task exited with code $exit_code ($stopped_reason)" >&2
    return 1
  fi

  echo "[INFO] Migrations applied"
}

verify_backend() {
  echo "[INFO] Verifying backend health"
  curl -fsS "$API_HEALTH_URL"
  echo

  echo "[INFO] Verifying backend smoke endpoint"
  curl -fsS "$API_SMOKE_URL" | python3 -c '
import json
import sys

obj = json.load(sys.stdin)
if not isinstance(obj, list):
    raise SystemExit("Expected smoke endpoint to return a JSON array.")
print(f"[INFO] Smoke endpoint returned {len(obj)} item(s)")
'
}

verify_frontend() {
  echo "[INFO] Verifying frontend index.html headers"
  aws s3api head-object \
    --bucket "$FRONTEND_BUCKET" \
    --key index.html \
    --region "$AWS_REGION" \
    --query '{CacheControl:CacheControl,ContentType:ContentType,LastModified:LastModified}'
}

echo "[INFO] Root: $ROOT_DIR"
echo "[INFO] Region: $AWS_REGION"
echo "[INFO] Backend image: $IMAGE_URI"
echo "[INFO] Backend enabled: $deploy_backend"
echo "[INFO] Frontend enabled: $deploy_frontend"
echo "[INFO] Backend auto-rollback: $auto_rollback"
echo "[INFO] Run database migrations: $run_migrations"
echo "[INFO] Allow local DATABASE_URL in base task definition: $allow_local_database"

if [[ "$deploy_backend" -eq 1 ]]; then
  echo "[INFO] Checking Docker availability"
  docker info >/dev/null

  build_dir="/tmp/shotdeck-server-build"
  rm -rf "$build_dir"
  mkdir -p "$build_dir"

  echo "[INFO] Preparing backend build context in $build_dir"
  rsync -a --delete \
    --exclude '.env' \
    --exclude '.env.remote' \
    --exclude '.dockerignore' \
    --exclude 'node_modules' \
    --exclude '.DS_Store' \
    "$ROOT_DIR/server/" "$build_dir/"

  echo "[INFO] Logging into ECR"
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

  echo "[INFO] Building and pushing backend image"
  docker buildx build \
    --platform linux/amd64 \
    --provenance=false \
    -t "$IMAGE_URI" \
    --push \
    "$build_dir"

  current_td_json="/tmp/shotdeck-task-current.json"
  next_td_json="/tmp/shotdeck-task-next.json"

  echo "[INFO] Fetching current ECS service task definition"
  current_task_definition_arn="$(aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION" \
    --query 'services[0].taskDefinition' \
    --output text)"

  if [[ -z "$current_task_definition_arn" || "$current_task_definition_arn" == "None" ]]; then
    echo "Failed to resolve current task definition for $ECS_SERVICE" >&2
    exit 1
  fi

  echo "[INFO] Current ECS task definition: $current_task_definition_arn"

  aws ecs describe-task-definition \
    --task-definition "$current_task_definition_arn" \
    --region "$AWS_REGION" \
    --query taskDefinition > "$current_td_json"

  echo "[INFO] Validating current ECS runtime env"
  python3 - <<'PY' "$current_td_json" "$allow_local_database"
import json
import sys

current_path = sys.argv[1]
allow_local = sys.argv[2] == "1"

with open(current_path, "r", encoding="utf-8") as fh:
    task = json.load(fh)

api = next((c for c in task.get("containerDefinitions", []) if c.get("name") == "api"), None)
if api is None:
    raise SystemExit("Missing api container in current task definition.")

env = {item.get("name"): item.get("value", "") for item in api.get("environment", [])}
db_url = env.get("DATABASE_URL", "")
if not db_url:
    raise SystemExit("Current ECS task definition is missing DATABASE_URL.")

if not allow_local and ("localhost" in db_url or "127.0.0.1" in db_url):
    raise SystemExit(
        "Refusing to deploy from a base task definition with a local DATABASE_URL. "
        "Rollback/fix ECS env first, or rerun with --allow-local-database if that is intentional."
    )

for required in ("PORT",):
    if required not in env:
        raise SystemExit(f"Current ECS task definition is missing required env: {required}")

print("[INFO] Current ECS DATABASE_URL passed safety checks")
PY

  echo "[INFO] Writing next ECS task definition"
  python3 - <<'PY' "$current_td_json" "$next_td_json" "$IMAGE_URI"
import json
import sys

current_path, next_path, image_uri = sys.argv[1:4]

with open(current_path, "r", encoding="utf-8") as fh:
    task = json.load(fh)

for key in [
    "taskDefinitionArn",
    "revision",
    "status",
    "requiresAttributes",
    "compatibilities",
    "registeredAt",
    "registeredBy",
    "deregisteredAt",
]:
    task.pop(key, None)

for container in task.get("containerDefinitions", []):
    if container.get("name") != "api":
        continue
    container["image"] = image_uri

with open(next_path, "w", encoding="utf-8") as fh:
    json.dump(task, fh)
PY

  echo "[INFO] Registering ECS task definition"
  new_td="$(aws ecs register-task-definition \
    --region "$AWS_REGION" \
    --cli-input-json "file://$next_td_json" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)"

  if [[ "$run_migrations" -eq 1 ]]; then
    if ! run_migrations_task "$new_td" "$next_td_json"; then
      echo "[ERROR] Migrations failed. The ECS service was not updated and still runs $current_task_definition_arn" >&2
      exit 1
    fi
  fi

  echo "[INFO] Updating ECS service to $new_td"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "$new_td" \
    --region "$AWS_REGION" >/dev/null

  echo "[INFO] Waiting for ECS service stability"
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION"

  echo "[INFO] Backend deployed: $new_td"

  if [[ "$skip_verify" -eq 0 ]]; then
    if ! verify_backend; then
      echo "[ERROR] Backend verification failed for $new_td" >&2
      if [[ "$auto_rollback" -eq 1 ]]; then
        rollback_backend "$current_task_definition_arn"
      else
        echo "[WARN] Auto-rollback disabled. Manual rollback target: $current_task_definition_arn" >&2
      fi
      exit 1
    fi
  fi
fi

if [[ "$deploy_frontend" -eq 1 ]]; then
  echo "[INFO] Building frontend"
  (
    cd "$ROOT_DIR/client"
    VITE_API_BASE="$FRONTEND_API_BASE" npm run build
  )

  echo "[INFO] Syncing frontend to s3://$FRONTEND_BUCKET"
  aws s3 sync "$ROOT_DIR/client/dist/" "s3://$FRONTEND_BUCKET/" \
    --delete \
    --exclude "index.html" \
    --exclude "vite.svg" \
    --cache-control "public,max-age=31536000,immutable" \
    --region "$AWS_REGION"

  aws s3 cp "$ROOT_DIR/client/dist/index.html" "s3://$FRONTEND_BUCKET/index.html" \
    --cache-control "no-cache,no-store,must-revalidate" \
    --content-type "text/html; charset=utf-8" \
    --region "$AWS_REGION"

  if [[ -f "$ROOT_DIR/client/dist/vite.svg" ]]; then
    aws s3 cp "$ROOT_DIR/client/dist/vite.svg" "s3://$FRONTEND_BUCKET/vite.svg" \
      --cache-control "public,max-age=300" \
      --content-type "image/svg+xml" \
      --region "$AWS_REGION"
  fi

  if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    echo "[INFO] Invalidating CloudFront paths"
    aws cloudfront create-invalidation \
      --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
      --paths "/" "/index.html" "/vite.svg" \
      --region "$AWS_REGION" >/dev/null
  fi

  echo "[INFO] Frontend deployed to s3://$FRONTEND_BUCKET"
fi

if [[ "$skip_verify" -eq 0 ]]; then
  if [[ "$deploy_frontend" -eq 1 ]]; then
    verify_frontend
  fi
fi

echo "[DONE] Deployment completed"
