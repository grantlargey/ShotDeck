#!/usr/bin/env bash

# Runs one command inside the production API's environment as a one-off ECS
# task: the service's current task definition (image, env, secrets), its
# network configuration and its launch settings. Waits for the task to stop
# and exits with the container's exit code (1 through 255). Runner failures
# such as a task-start or wait failure exit 1.
#
# This is how the owner account is created in production, where the database
# is only reachable from inside the VPC:
#
#   hash="$(cd server && npm run --silent admin -- hash)"   # prompts for the password locally
#   bash infra/run-api-task.sh node src/admin.js create-owner --email you@example.com --password-hash "$hash"
#
# Other examples:
#   bash infra/run-api-task.sh node src/admin.js list
#   bash infra/run-api-task.sh node src/admin.js reset-password --email you@example.com --password-hash "$hash"
#
# Options (before the command): --region, --ecs-cluster, --ecs-service,
# --task-definition (defaults to the service's current one),
# --expected-image-digest and --status-file.

set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: bash infra/run-api-task.sh [options] -- <command...>
       bash infra/run-api-task.sh [options] <command...>

Options:
  --region REGION           AWS region override
  --ecs-cluster NAME        ECS cluster override
  --ecs-service NAME        ECS service override
  --task-definition ARN     Task definition override (default: the service's current one)
  --expected-image-digest D Require the api image and stopped task to use sha256 digest D
  --status-file PATH        Write task ARN, definition, image digest and exit status as JSON
  -h, --help                Show this help
EOF
}

DEPLOY_REGION=""
ECS_CLUSTER_OVERRIDE=""
ECS_SERVICE_OVERRIDE=""
TASK_DEFINITION_OVERRIDE=""
EXPECTED_IMAGE_DIGEST=""
STATUS_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) DEPLOY_REGION="${2:-}"; shift 2 ;;
    --ecs-cluster) ECS_CLUSTER_OVERRIDE="${2:-}"; shift 2 ;;
    --ecs-service) ECS_SERVICE_OVERRIDE="${2:-}"; shift 2 ;;
    --task-definition) TASK_DEFINITION_OVERRIDE="${2:-}"; shift 2 ;;
    --expected-image-digest) EXPECTED_IMAGE_DIGEST="${2:-}"; shift 2 ;;
    --status-file) STATUS_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *) break ;;
  esac
done

if [[ -n "$EXPECTED_IMAGE_DIGEST" && ! "$EXPECTED_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "--expected-image-digest must be sha256 followed by 64 lowercase hexadecimal characters." >&2
  exit 1
fi

if [[ -n "$STATUS_FILE" && -e "$STATUS_FILE" ]]; then
  echo "--status-file must name a new file: $STATUS_FILE" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Missing command to run." >&2
  usage >&2
  exit 1
fi

for cmd in aws python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

AWS_REGION="${DEPLOY_REGION:-${AWS_REGION:-us-east-1}}"
ECS_CLUSTER="${ECS_CLUSTER_OVERRIDE:-shotdeck-prod2}"
ECS_SERVICE="${ECS_SERVICE_OVERRIDE:-shotdeck-api-service-hf9lczwr}"
export AWS_REGION

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/shotdeck-run-task.XXXXXX")"
chmod 700 "$work_dir"
trap 'rm -rf "$work_dir"' EXIT
service_json="$work_dir/service.json"
task_json="$work_dir/task-definition.json"
network_json="$work_dir/network.json"
capacity_json="$work_dir/capacity.json"
settings_txt="$work_dir/settings.txt"
overrides_json="$work_dir/overrides.json"
run_json="$work_dir/run.json"
logs_json="$work_dir/logs.json"

echo "[INFO] Cluster: $ECS_CLUSTER  Service: $ECS_SERVICE  Region: $AWS_REGION"

aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION" \
  --query 'services[0]' \
  --output json > "$service_json"

task_definition="$TASK_DEFINITION_OVERRIDE"
if [[ -z "$task_definition" ]]; then
  task_definition="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["taskDefinition"])' "$service_json")"
fi
echo "[INFO] Task definition: $task_definition"

aws ecs describe-task-definition \
  --task-definition "$task_definition" \
  --region "$AWS_REGION" \
  --query taskDefinition \
  --output json > "$task_json"

if [[ -n "$EXPECTED_IMAGE_DIGEST" ]]; then
  python3 - "$task_json" "$EXPECTED_IMAGE_DIGEST" <<'PY'
import json
import sys

task_path, expected = sys.argv[1:3]
with open(task_path, "r", encoding="utf-8") as fh:
    task = json.load(fh)
api = next((container for container in task.get("containerDefinitions", []) if container.get("name") == "api"), None)
image = (api or {}).get("image", "")
if not image.endswith("@" + expected):
    raise SystemExit(f"The api task definition is not pinned to the expected image digest: {image}")
PY
fi

python3 - "$service_json" "$task_json" "$network_json" "$capacity_json" "$settings_txt" <<'PY'
import json
import sys

service_path, task_path, network_path, capacity_path, settings_path = sys.argv[1:6]

with open(service_path, "r", encoding="utf-8") as fh:
    service = json.load(fh)
with open(task_path, "r", encoding="utf-8") as fh:
    task = json.load(fh)

network = service.get("networkConfiguration")
if not network:
    raise SystemExit("Service has no network configuration to run the task in.")
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

python3 -c 'import json, sys; print(json.dumps({"containerOverrides": [{"name": "api", "command": sys.argv[1:]}]}))' "$@" > "$overrides_json"

launch_type="$(sed -n 1p "$settings_txt")"
log_group="$(sed -n 2p "$settings_txt")"
log_prefix="$(sed -n 3p "$settings_txt")"

if [[ -n "$launch_type" ]]; then
  placement_flag="--launch-type"
  placement_value="$launch_type"
else
  placement_flag="--capacity-provider-strategy"
  placement_value="file://$capacity_json"
fi

echo "[INFO] Running: $*"
aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$task_definition" \
  "$placement_flag" "$placement_value" \
  --network-configuration "file://$network_json" \
  --overrides "file://$overrides_json" \
  --started-by "run-api-task" \
  --region "$AWS_REGION" \
  --output json > "$run_json"

task_arn="$(python3 - "$run_json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    result = json.load(fh)

failures = result.get("failures") or []
for failure in failures:
    print(f"[ERROR] RunTask failure: {failure.get('reason')} {failure.get('detail') or ''}", file=sys.stderr)
tasks = result.get("tasks") or []
if failures or not tasks:
    raise SystemExit("RunTask did not start the task.")
print(tasks[0]["taskArn"])
PY
)"
task_id="${task_arn##*/}"

echo "[INFO] Waiting for task $task_id to finish"
if ! aws ecs wait tasks-stopped \
  --cluster "$ECS_CLUSTER" \
  --tasks "$task_arn" \
  --region "$AWS_REGION"; then
  echo "[ERROR] Timed out waiting for task $task_arn" >&2
  exit 1
fi

exit_code="$(aws ecs describe-tasks \
  --cluster "$ECS_CLUSTER" \
  --tasks "$task_arn" \
  --region "$AWS_REGION" \
  --query "tasks[0].containers[?name=='api'] | [0].exitCode" \
  --output text)"
stopped_reason="$(aws ecs describe-tasks \
  --cluster "$ECS_CLUSTER" \
  --tasks "$task_arn" \
  --region "$AWS_REGION" \
  --query 'tasks[0].stoppedReason' \
  --output text)"
image_digest="$(aws ecs describe-tasks \
  --cluster "$ECS_CLUSTER" \
  --tasks "$task_arn" \
  --region "$AWS_REGION" \
  --query "tasks[0].containers[?name=='api'] | [0].imageDigest" \
  --output text)"

if [[ -n "$STATUS_FILE" ]]; then
  python3 - "$STATUS_FILE" "$task_arn" "$task_definition" "$exit_code" "$stopped_reason" "$image_digest" <<'PY'
import json
import os
import sys

path, task_arn, task_definition, exit_code, stopped_reason, image_digest = sys.argv[1:7]
parent = os.path.dirname(os.path.abspath(path))
if not os.path.isdir(parent):
    raise SystemExit(f"Status-file directory does not exist: {parent}")
stored_exit_code = int(exit_code) if exit_code.isdigit() else exit_code
with open(path, "x", encoding="utf-8") as fh:
    json.dump({
        "task_arn": task_arn,
        "task_definition": task_definition,
        "exit_code": stored_exit_code,
        "stopped_reason": stopped_reason,
        "image_digest": image_digest,
    }, fh, indent=2)
    fh.write("\n")
os.chmod(path, 0o600)
PY
fi

if [[ -n "$EXPECTED_IMAGE_DIGEST" && "$image_digest" != "$EXPECTED_IMAGE_DIGEST" ]]; then
  echo "[ERROR] Task used image digest $image_digest, expected $EXPECTED_IMAGE_DIGEST" >&2
  exit 1
fi

# CloudWatch can lag a few seconds behind a task that just stopped, and some
# IAM users can't read logs at all; the exit code below is the real result.
if [[ -n "$log_group" && -n "$log_prefix" ]]; then
  logs_printed=0
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
    echo "[WARN] Could not read the task's logs from $log_group; the exit code still decides the result."
  fi
fi

if [[ ! "$exit_code" =~ ^[0-9]+$ ]] || (( exit_code < 0 || exit_code > 255 )); then
  echo "[ERROR] Task returned an invalid exit code: $exit_code ($stopped_reason)" >&2
  exit 1
fi

if [[ "$exit_code" != "0" ]]; then
  echo "[ERROR] Task exited with code $exit_code ($stopped_reason)" >&2
  exit "$exit_code"
fi

echo "[DONE] Task finished successfully"
