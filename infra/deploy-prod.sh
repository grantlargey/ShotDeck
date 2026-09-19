#!/usr/bin/env bash

set -euo pipefail
umask 077

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
  --skip-build          Reuse an image already uploaded to ECR by the approved monolithic method
  --prebuilt-frontend   Reuse the existing client/dist build instead of rebuilding it
  --image-digest DIGEST Require and pin the ECR image at sha256:DIGEST
  --allow-local-database
                       Allow localhost/127.0.0.1 in a base ECS task definition
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
  --site-url URL        Public frontend URL override
  --image-tag TAG       Immutable image tag already present in ECR
  -h, --help            Show this help
EOF
}

deploy_backend=1
deploy_frontend=1
skip_verify=0
auto_rollback=1
run_migrations=1
allow_local_database=0
skip_build=0
prebuilt_frontend=0

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
SITE_URL_OVERRIDE=""
IMAGE_TAG_OVERRIDE=""
IMAGE_DIGEST_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only) deploy_frontend=0; shift ;;
    --frontend-only) deploy_backend=0; shift ;;
    --skip-verify) skip_verify=1; shift ;;
    --no-rollback) auto_rollback=0; shift ;;
    --skip-migrations) run_migrations=0; shift ;;
    --skip-build) skip_build=1; shift ;;
    --prebuilt-frontend) prebuilt_frontend=1; shift ;;
    --image-digest) IMAGE_DIGEST_OVERRIDE="${2:-}"; shift 2 ;;
    --allow-local-database) allow_local_database=1; shift ;;
    --region) DEPLOY_REGION="${2:-}"; shift 2 ;;
    --account-id) AWS_ACCOUNT_ID_OVERRIDE="${2:-}"; shift 2 ;;
    --ecr-repo) ECR_REPO_OVERRIDE="${2:-}"; shift 2 ;;
    --ecs-cluster) ECS_CLUSTER_OVERRIDE="${2:-}"; shift 2 ;;
    --ecs-service) ECS_SERVICE_OVERRIDE="${2:-}"; shift 2 ;;
    --frontend-bucket) FRONTEND_BUCKET_OVERRIDE="${2:-}"; shift 2 ;;
    --frontend-api-base) FRONTEND_API_BASE_OVERRIDE="${2:-}"; shift 2 ;;
    --cloudfront-distribution-id) CLOUDFRONT_DISTRIBUTION_ID_OVERRIDE="${2:-}"; shift 2 ;;
    --api-health-url) API_HEALTH_URL_OVERRIDE="${2:-}"; shift 2 ;;
    --api-smoke-url) API_SMOKE_URL_OVERRIDE="${2:-}"; shift 2 ;;
    --site-url) SITE_URL_OVERRIDE="${2:-}"; shift 2 ;;
    --image-tag) IMAGE_TAG_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

if [[ -n "$IMAGE_DIGEST_OVERRIDE" && ! "$IMAGE_DIGEST_OVERRIDE" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "--image-digest must be sha256 followed by 64 lowercase hexadecimal characters." >&2
  exit 1
fi

if [[ "$deploy_backend" -eq 1 && "$skip_build" -eq 0 ]]; then
  echo "Backend builds must use buildx --load, docker save and the approved monolithic ECR upload method." >&2
  echo "No reliable monolithic uploader exists in this repository; push separately, then use --skip-build." >&2
  exit 1
fi
if [[ "$deploy_backend" -eq 1 && ( -z "$IMAGE_TAG_OVERRIDE" || -z "$IMAGE_DIGEST_OVERRIDE" ) ]]; then
  echo "Backend deployment requires --image-tag and --image-digest for an image already in ECR." >&2
  exit 1
fi

require_cmd aws
require_cmd python3
if [[ "$deploy_frontend" -eq 1 && "$prebuilt_frontend" -eq 0 ]]; then
  require_cmd npm
fi
if [[ "$skip_verify" -eq 0 ]]; then
  require_cmd curl
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
SITE_URL="${SITE_URL_OVERRIDE:-https://scriptdeckdemo.com}"
IMAGE_TAG="${IMAGE_TAG_OVERRIDE:-}"
IMAGE_DIGEST="$IMAGE_DIGEST_OVERRIDE"
IMAGE_REF="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}@${IMAGE_DIGEST}"
FRONTEND_DIST_DIR="${SHOTDECK_FRONTEND_DIST_DIR:-$ROOT_DIR/client/dist}"
export AWS_REGION

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/shotdeck-deploy.XXXXXX")"
chmod 700 "$work_dir"

describe_service_to() {
  aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
    --region "$AWS_REGION" --query 'services[0]' --output json > "$1"
  chmod 600 "$1"
}

assert_service_deployed_file() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, expected_td, expected_count = sys.argv[1:4]
with open(path, encoding="utf-8") as fh:
    service = json.load(fh)
counts = {name: service.get(name) for name in ("desiredCount", "runningCount", "pendingCount")}
expected = {"desiredCount": int(expected_count), "runningCount": int(expected_count), "pendingCount": 0}
if counts != expected:
    raise SystemExit(f"API service counts do not match: {counts}, expected {expected}")
if service.get("taskDefinition") != expected_td:
    raise SystemExit(f"API service task definition is {service.get('taskDefinition')}, expected {expected_td}")
primary = [item for item in service.get("deployments") or [] if item.get("status") == "PRIMARY"]
if len(primary) != 1 or primary[0].get("taskDefinition") != expected_td or primary[0].get("rolloutState") != "COMPLETED":
    raise SystemExit(f"API service does not have one completed PRIMARY deployment on {expected_td}")
PY
}

trap 'rm -rf "$work_dir"' EXIT

verify_task_definition_image() {
  local task_definition="$1"
  local target="$2"
  aws ecs describe-task-definition --task-definition "$task_definition" --region "$AWS_REGION" \
    --query taskDefinition --output json > "$target"
  chmod 600 "$target"
  python3 - "$target" "$IMAGE_REF" <<'PY'
import json, sys
path, expected = sys.argv[1:3]
with open(path, encoding="utf-8") as fh:
    task = json.load(fh)
api = next((item for item in task.get("containerDefinitions", []) if item.get("name") == "api"), None)
image = (api or {}).get("image")
if image != expected:
    raise SystemExit(f"The api task definition image is {image}, expected immutable {expected}")
PY
}

validate_task_definition_database() {
  python3 - "$1" "$allow_local_database" <<'PY'
import json, sys
path, allow_local = sys.argv[1], sys.argv[2] == "1"
with open(path, encoding="utf-8") as fh:
    task = json.load(fh)
api = next((item for item in task.get("containerDefinitions", []) if item.get("name") == "api"), None)
if api is None:
    raise SystemExit("Missing api container in task definition.")
env = {item.get("name"): item.get("value", "") for item in api.get("environment", [])}
db_url = env.get("DATABASE_URL", "")
if not db_url:
    raise SystemExit("Task definition is missing DATABASE_URL.")
if not allow_local and ("localhost" in db_url or "127.0.0.1" in db_url):
    raise SystemExit("Refusing a base task definition with a local DATABASE_URL.")
if "PORT" not in env:
    raise SystemExit("Task definition is missing required env: PORT")
PY
}

verify_ecr_digest() {
  local found_digest
  found_digest="$(aws ecr describe-images --repository-name "$ECR_REPO" \
    --image-ids "imageTag=$IMAGE_TAG" --region "$AWS_REGION" \
    --query 'imageDetails[0].imageDigest' --output text)"
  if [[ "$found_digest" != "$IMAGE_DIGEST" ]]; then
    echo "ECR tag $IMAGE_TAG resolves to $found_digest, expected $IMAGE_DIGEST." >&2
    exit 1
  fi
}

verify_running_task_digests() {
  local task_definition="$1"
  local expected_count="$2"
  local arns_file="$work_dir/running-task-arns.json"
  local tasks_file="$work_dir/running-tasks.json"
  local task_arns=()
  aws ecs list-tasks --cluster "$ECS_CLUSTER" --service-name "$ECS_SERVICE" \
    --desired-status RUNNING --region "$AWS_REGION" --query taskArns --output json > "$arns_file"
  while IFS= read -r task_arn; do
    [[ -n "$task_arn" ]] && task_arns+=("$task_arn")
  done < <(python3 - "$arns_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    for arn in json.load(fh): print(arn)
PY
)
  if [[ "${#task_arns[@]}" -ne "$expected_count" ]]; then
    echo "Expected $expected_count running API tasks, found ${#task_arns[@]}." >&2
    return 1
  fi
  aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "${task_arns[@]}" \
    --region "$AWS_REGION" --output json > "$tasks_file"
  python3 - "$tasks_file" "$task_definition" "$IMAGE_DIGEST" "$expected_count" <<'PY'
import json, sys
path, expected_td, expected_digest, expected_count = sys.argv[1:5]
with open(path, encoding="utf-8") as fh:
    result = json.load(fh)
if result.get("failures"):
    raise SystemExit(f"DescribeTasks failures: {result['failures']}")
tasks = result.get("tasks") or []
if len(tasks) != int(expected_count):
    raise SystemExit(f"Expected {expected_count} running tasks, found {len(tasks)}")
for task in tasks:
    if task.get("taskDefinitionArn") != expected_td:
        raise SystemExit(f"Running task uses {task.get('taskDefinitionArn')}, expected {expected_td}")
    api = next((item for item in task.get("containers", []) if item.get("name") == "api"), None)
    if (api or {}).get("imageDigest") != expected_digest:
        raise SystemExit(f"Running task digest is {(api or {}).get('imageDigest')}, expected {expected_digest}")
PY
}

verify_backend() {
  echo "[INFO] Verifying backend health"
  curl -fsS "$API_HEALTH_URL" || return 1
  echo
  echo "[INFO] Verifying backend smoke endpoint"
  curl -fsS "$API_SMOKE_URL" | python3 -c '
import json, sys
obj = json.load(sys.stdin)
if not isinstance(obj, list): raise SystemExit("Expected smoke endpoint to return a JSON array.")
print(f"[INFO] Smoke endpoint returned {len(obj)} item(s)")
' || return 1
}

verify_frontend() {
  aws s3api head-object --bucket "$FRONTEND_BUCKET" --key index.html --region "$AWS_REGION" \
    --query '{CacheControl:CacheControl,ContentType:ContentType,LastModified:LastModified}'
  curl -fsS "$SITE_URL/" > "$work_dir/index-served.html"
  python3 - "$FRONTEND_DIST_DIR/index.html" "$work_dir/index-served.html" <<'PY'
import re
import sys
with open(sys.argv[1], encoding="utf-8") as fh: expected_html = fh.read()
with open(sys.argv[2], encoding="utf-8") as fh: served_html = fh.read()
assets = set(re.findall(r"assets/[^\"' ]+\.(?:js|css)", expected_html))
if not assets:
    raise SystemExit("Built index.html names no JavaScript or CSS assets.")
missing = sorted(asset for asset in assets if asset not in served_html)
if missing:
    raise SystemExit(f"Served index.html does not name built assets: {missing}")
PY
}

deploy_frontend_artifact() {
  aws s3 sync "$FRONTEND_DIST_DIR/" "s3://$FRONTEND_BUCKET/" --delete \
    --exclude "index.html" --cache-control "public,max-age=31536000,immutable" --region "$AWS_REGION"
  aws s3 cp "$FRONTEND_DIST_DIR/index.html" "s3://$FRONTEND_BUCKET/index.html" \
    --cache-control "no-cache,no-store,must-revalidate" --content-type "text/html; charset=utf-8" \
    --region "$AWS_REGION"
  if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
      --paths "/" "/index.html" --region "$AWS_REGION" >/dev/null
  fi
}

if [[ "$deploy_frontend" -eq 1 ]]; then
  if [[ "$prebuilt_frontend" -eq 0 ]]; then
    echo "[INFO] Building frontend before backend changes"
    (cd "$ROOT_DIR/client" && VITE_API_BASE="$FRONTEND_API_BASE" npm run build)
  fi
  if [[ ! -s "$FRONTEND_DIST_DIR/index.html" ]]; then
    echo "Frontend artifact is missing $FRONTEND_DIST_DIR/index.html." >&2
    exit 1
  fi
fi

new_td=""
current_task_definition_arn=""
current_desired_count=""

if [[ "$deploy_backend" -eq 1 ]]; then
  verify_ecr_digest
  describe_service_to "$work_dir/service-before.json"
  current_task_definition_arn="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["taskDefinition"])' "$work_dir/service-before.json")"
  current_desired_count="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["desiredCount"])' "$work_dir/service-before.json")"

  current_td_json="$work_dir/task-definition-current.json"
  next_td_json="$work_dir/task-definition-next.json"
  aws ecs describe-task-definition --task-definition "$current_task_definition_arn" \
    --region "$AWS_REGION" --query taskDefinition --output json > "$current_td_json"
  chmod 600 "$current_td_json"
  validate_task_definition_database "$current_td_json"
  python3 - "$current_td_json" "$next_td_json" "$IMAGE_REF" <<'PY'
import json, os, sys
source, target, image = sys.argv[1:4]
with open(source, encoding="utf-8") as fh: task = json.load(fh)
for key in ("taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities",
            "registeredAt", "registeredBy", "deregisteredAt"):
    task.pop(key, None)
api = next((item for item in task.get("containerDefinitions", []) if item.get("name") == "api"), None)
if api is None: raise SystemExit("Missing api container in task definition.")
api["image"] = image
with open(target, "x", encoding="utf-8") as fh: json.dump(task, fh)
os.chmod(target, 0o600)
PY
  new_td="$(aws ecs register-task-definition --region "$AWS_REGION" \
    --cli-input-json "file://$next_td_json" --query 'taskDefinition.taskDefinitionArn' --output text)"
  verify_task_definition_image "$new_td" "$work_dir/task-definition-registered.json"
  if [[ "$run_migrations" -eq 1 ]]; then
    bash "$ROOT_DIR/infra/run-api-task.sh" --region "$AWS_REGION" \
      --ecs-cluster "$ECS_CLUSTER" --ecs-service "$ECS_SERVICE" --task-definition "$new_td" \
      --expected-image-digest "$IMAGE_DIGEST" --status-file "$work_dir/migration-task-status.json" \
      -- node src/migrate.js
  fi

  desired_count="$current_desired_count"
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
    --task-definition "$new_td" --desired-count "$desired_count" --region "$AWS_REGION" >/dev/null
  aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION"
  describe_service_to "$work_dir/service-deployed.json"
  assert_service_deployed_file "$work_dir/service-deployed.json" "$new_td" "$desired_count"
  verify_running_task_digests "$new_td" "$desired_count"
  if [[ "$skip_verify" -eq 0 ]]; then
    if ! verify_backend; then
      echo "Backend verification failed for $new_td." >&2
      if [[ "$run_migrations" -eq 0 && "$auto_rollback" -eq 1 ]]; then
        echo "Rolling the API service back to $current_task_definition_arn before any frontend upload." >&2
        aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
          --task-definition "$current_task_definition_arn" --region "$AWS_REGION" >/dev/null
        aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION"
      fi
      exit 1
    fi
  fi
fi

if [[ "$deploy_frontend" -eq 1 ]]; then deploy_frontend_artifact; fi
if [[ "$skip_verify" -eq 0 && "$deploy_frontend" -eq 1 ]]; then verify_frontend; fi

echo "[DONE] Deployment completed"
