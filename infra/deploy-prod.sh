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
  --skip-build          Reuse an image pushed by the runbook's monolithic uploader
  --prebuilt-frontend   Reuse the existing client/dist build instead of rebuilding it
  --cutover             Run the irreversible captured-scene cutover under its safety gates
  --complete-cutover    Restore saved ingress and ECS rollback settings after manual verification
  --cutover-snapshot-id ID
                       Completed pre-cutover RDS snapshot (required with --cutover)
  --cutover-db-instance-id ID
                       DB instance the completed snapshot must belong to
  --cutover-state-dir DIR
                       New state directory for --cutover; existing one for --complete-cutover
  --resume-desired-count N
                       Desired API count during restricted cutover verification
  --verification-security-group SG
                       Sole security group attached to the API load balancer
  --verification-cidr CIDR
                       Sole IPv4 CIDR allowed to reach the verification port
  --verification-port PORT
                       Restricted API load-balancer port (default: 443)
  --verification-command FILE
                       Executable issue-16 smoke wrapper run before manual verification
  --verification-record FILE
                       Nonempty manual verification record required by --complete-cutover
  --report-bucket NAME  Bucket holding the conversion report (required with --cutover)
  --migration-report-key KEY
                       New ops/inventory/*.json key for the conversion report
  --task-definition ARN Already-registered and read-only-probed definition for --cutover
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
cutover=0
complete_cutover=0
cutover_safety_engaged=0
cutover_task_started=0

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
MIGRATION_REPORT_KEY_OVERRIDE=""
REPORT_BUCKET=""
CUTOVER_SNAPSHOT_ID=""
CUTOVER_DB_INSTANCE_ID=""
CUTOVER_STATE_DIR=""
RESUME_DESIRED_COUNT=""
VERIFICATION_SECURITY_GROUP=""
VERIFICATION_CIDR=""
VERIFICATION_PORT=443
VERIFICATION_COMMAND=""
VERIFICATION_RECORD=""
TASK_DEFINITION_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only) deploy_frontend=0; shift ;;
    --frontend-only) deploy_backend=0; shift ;;
    --skip-verify) skip_verify=1; shift ;;
    --no-rollback) auto_rollback=0; shift ;;
    --skip-migrations) run_migrations=0; shift ;;
    --skip-build) skip_build=1; shift ;;
    --prebuilt-frontend) prebuilt_frontend=1; shift ;;
    --cutover) cutover=1; shift ;;
    --complete-cutover) complete_cutover=1; shift ;;
    --cutover-snapshot-id) CUTOVER_SNAPSHOT_ID="${2:-}"; shift 2 ;;
    --cutover-db-instance-id) CUTOVER_DB_INSTANCE_ID="${2:-}"; shift 2 ;;
    --cutover-state-dir) CUTOVER_STATE_DIR="${2:-}"; shift 2 ;;
    --resume-desired-count) RESUME_DESIRED_COUNT="${2:-}"; shift 2 ;;
    --verification-security-group) VERIFICATION_SECURITY_GROUP="${2:-}"; shift 2 ;;
    --verification-cidr) VERIFICATION_CIDR="${2:-}"; shift 2 ;;
    --verification-port) VERIFICATION_PORT="${2:-}"; shift 2 ;;
    --verification-command) VERIFICATION_COMMAND="${2:-}"; shift 2 ;;
    --verification-record) VERIFICATION_RECORD="${2:-}"; shift 2 ;;
    --report-bucket) REPORT_BUCKET="${2:-}"; shift 2 ;;
    --migration-report-key) MIGRATION_REPORT_KEY_OVERRIDE="${2:-}"; shift 2 ;;
    --task-definition) TASK_DEFINITION_OVERRIDE="${2:-}"; shift 2 ;;
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

if [[ "$cutover" -eq 1 && "$complete_cutover" -eq 1 ]]; then
  echo "Choose exactly one of --cutover and --complete-cutover." >&2
  exit 1
fi

if [[ -n "$IMAGE_DIGEST_OVERRIDE" && ! "$IMAGE_DIGEST_OVERRIDE" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "--image-digest must be sha256 followed by 64 lowercase hexadecimal characters." >&2
  exit 1
fi

if [[ "$complete_cutover" -eq 1 ]]; then
  if [[ -z "$CUTOVER_STATE_DIR" || ! -d "$CUTOVER_STATE_DIR" ]]; then
    echo "--complete-cutover requires an existing --cutover-state-dir." >&2
    exit 1
  fi
  if [[ -z "$VERIFICATION_RECORD" || ! -s "$VERIFICATION_RECORD" ]]; then
    echo "--complete-cutover requires a nonempty --verification-record from the manual checks." >&2
    exit 1
  fi
else
  if [[ "$deploy_backend" -eq 1 && "$skip_build" -eq 0 ]]; then
    echo "Backend builds must use the runbook's proven buildx --load, docker save and monolithic ECR uploader." >&2
    echo "No reliable monolithic uploader exists in this repository; push separately, then use --skip-build." >&2
    exit 1
  fi
  if [[ "$deploy_backend" -eq 1 && ( -z "$IMAGE_TAG_OVERRIDE" || -z "$IMAGE_DIGEST_OVERRIDE" ) ]]; then
    echo "Backend deployment requires --image-tag and --image-digest for an image already in ECR." >&2
    exit 1
  fi
fi

if [[ "$cutover" -eq 1 ]]; then
  if [[ "$deploy_backend" -ne 1 || "$deploy_frontend" -ne 1 ]]; then
    echo "--cutover requires a matching backend and frontend deployment." >&2
    exit 1
  fi
  if [[ "$skip_build" -ne 1 || "$prebuilt_frontend" -ne 1 ]]; then
    echo "--cutover requires --skip-build and --prebuilt-frontend from the runbook's proven artifacts." >&2
    exit 1
  fi
  if [[ "$run_migrations" -ne 1 || "$skip_verify" -ne 0 ]]; then
    echo "--cutover forbids --skip-migrations and --skip-verify." >&2
    exit 1
  fi
  if [[ -z "$CUTOVER_SNAPSHOT_ID" || -z "$CUTOVER_DB_INSTANCE_ID" || -z "$CUTOVER_STATE_DIR" \
    || -z "$RESUME_DESIRED_COUNT" || -z "$VERIFICATION_SECURITY_GROUP" \
    || -z "$VERIFICATION_CIDR" || -z "$TASK_DEFINITION_OVERRIDE" \
    || -z "$MIGRATION_REPORT_KEY_OVERRIDE" || -z "$REPORT_BUCKET" \
    || -z "$VERIFICATION_COMMAND" ]]; then
    echo "--cutover requires snapshot, DB instance, new state directory, resume count, verification barrier/command, task definition and report options." >&2
    exit 1
  fi
  if [[ ! -x "$VERIFICATION_COMMAND" ]]; then
    echo "--verification-command must name an executable file." >&2
    exit 1
  fi
  if [[ ! "$RESUME_DESIRED_COUNT" =~ ^[1-9][0-9]*$ ]]; then
    echo "--resume-desired-count must be a positive integer." >&2
    exit 1
  fi
  if [[ ! "$VERIFICATION_PORT" =~ ^[0-9]+$ ]] || (( VERIFICATION_PORT < 1 || VERIFICATION_PORT > 65535 )); then
    echo "--verification-port must be an integer from 1 through 65535." >&2
    exit 1
  fi
  python3 - "$VERIFICATION_CIDR" <<'PY'
import ipaddress
import sys
network = ipaddress.ip_network(sys.argv[1], strict=False)
if network.version != 4:
    raise SystemExit("--verification-cidr must be an IPv4 CIDR.")
PY
  if [[ -e "$CUTOVER_STATE_DIR" ]]; then
    echo "--cutover-state-dir must not already exist: $CUTOVER_STATE_DIR" >&2
    exit 1
  fi
  auto_rollback=0
fi

require_cmd aws
require_cmd python3
if [[ "$deploy_frontend" -eq 1 && "$complete_cutover" -eq 0 && "$prebuilt_frontend" -eq 0 ]]; then
  require_cmd npm
fi
if [[ "$skip_verify" -eq 0 && "$complete_cutover" -eq 0 ]]; then
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
MIGRATION_REPORT_KEY="${MIGRATION_REPORT_KEY_OVERRIDE:-ops/inventory/deploy-${IMAGE_TAG}.json}"
FRONTEND_DIST_DIR="${SHOTDECK_FRONTEND_DIST_DIR:-$ROOT_DIR/client/dist}"
export AWS_REGION

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/shotdeck-deploy.XXXXXX")"
chmod 700 "$work_dir"

describe_service_to() {
  aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
    --region "$AWS_REGION" --query 'services[0]' > "$1"
  chmod 600 "$1"
}

assert_service_zero_file() {
  python3 - "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    service = json.load(fh)
counts = {name: service.get(name) for name in ("desiredCount", "runningCount", "pendingCount")}
if counts != {"desiredCount": 0, "runningCount": 0, "pendingCount": 0}:
    raise SystemExit(f"API writers are not stopped: {counts}")
PY
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

force_cutover_zero() {
  echo "[ERROR] Forcing the cutover API service to zero writers." >&2
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
    --desired-count 0 --region "$AWS_REGION" >/dev/null || return 1
  aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
    --region "$AWS_REGION" || return 1
  describe_service_to "$work_dir/service-after-failure.json" || return 1
  assert_service_zero_file "$work_dir/service-after-failure.json"
}

apply_deployment_configuration() {
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
    --deployment-configuration "file://$1" --region "$AWS_REGION" >/dev/null
}

assert_rollback_disabled_file() {
  python3 - "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    config = json.load(fh).get("deploymentConfiguration") or {}
circuit = config.get("deploymentCircuitBreaker") or {}
alarms = config.get("alarms")
if circuit.get("enable") is not False or circuit.get("rollback") is not False:
    raise SystemExit(f"ECS deployment circuit breaker is not disabled: {circuit}")
if alarms is not None and (alarms.get("enable") is not False or alarms.get("rollback") is not False):
    raise SystemExit(f"ECS deployment alarm rollback is not disabled: {alarms}")
PY
}

disable_cutover_rollback() {
  apply_deployment_configuration "$CUTOVER_STATE_DIR/deployment-configuration-disabled.json"
  describe_service_to "$work_dir/service-rollback-disabled.json"
  assert_rollback_disabled_file "$work_dir/service-rollback-disabled.json"
}

describe_verification_group_to() {
  aws ec2 describe-security-groups --group-ids "$VERIFICATION_SECURITY_GROUP" \
    --region "$AWS_REGION" > "$1"
  chmod 600 "$1"
}

assert_writer_barrier_file() {
  python3 - "$1" "$VERIFICATION_CIDR" "$VERIFICATION_PORT" <<'PY'
import ipaddress, json, sys
path, expected_cidr, port = sys.argv[1:4]
expected_cidr = str(ipaddress.ip_network(expected_cidr, strict=False))
port = int(port)
with open(path, encoding="utf-8") as fh:
    groups = json.load(fh).get("SecurityGroups") or []
if len(groups) != 1:
    raise SystemExit("Could not inspect exactly one verification security group.")
covering = []
for permission in groups[0].get("IpPermissions") or []:
    protocol = permission.get("IpProtocol")
    if protocol == "-1" or (protocol in {"tcp", "6"} and permission.get("FromPort", -1) <= port <= permission.get("ToPort", -1)):
        covering.append(permission)
if len(covering) != 1:
    raise SystemExit(f"Verification port has {len(covering)} ingress permissions, expected one.")
permission = covering[0]
if permission.get("IpProtocol") not in {"tcp", "6"} or permission.get("FromPort") != port or permission.get("ToPort") != port:
    raise SystemExit("Verification ingress is not restricted to the exact TCP port.")
if permission.get("Ipv6Ranges") or permission.get("PrefixListIds") or permission.get("UserIdGroupPairs"):
    raise SystemExit("Verification ingress permits a non-IPv4 source.")
ranges = permission.get("IpRanges") or []
if len(ranges) != 1 or str(ipaddress.ip_network(ranges[0].get("CidrIp"), strict=False)) != expected_cidr:
    raise SystemExit(f"Verification ingress is not restricted to {expected_cidr}.")
PY
}

assert_writer_barrier() {
  describe_verification_group_to "$work_dir/security-group-current.json"
  assert_writer_barrier_file "$work_dir/security-group-current.json"
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$cutover_safety_engaged" -eq 1 ]]; then
    set +e
    if [[ "$cutover_task_started" -eq 1 ]]; then
      echo "[ERROR] A failure occurred after conversion started; the database schema is unknown." >&2
    fi
    if [[ -s "$CUTOVER_STATE_DIR/deployment-configuration-disabled.json" ]]; then
      disable_cutover_rollback
      if [[ $? -ne 0 ]]; then echo "[ERROR] Could not prove ECS managed rollback is disabled." >&2; fi
    fi
    assert_writer_barrier
    if [[ $? -ne 0 ]]; then
      echo "[ERROR] The restricted-ingress barrier could not be proved; zero service count is mandatory." >&2
    fi
    force_cutover_zero
    if [[ $? -ne 0 ]]; then
      echo "[ERROR] Could not prove desired/running/pending counts reached zero; writer state is unknown." >&2
    fi
    set -e
  fi
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT

verify_task_definition_image() {
  local task_definition="$1"
  local target="$2"
  aws ecs describe-task-definition --task-definition "$task_definition" --region "$AWS_REGION" \
    --query taskDefinition > "$target"
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
    --desired-status RUNNING --region "$AWS_REGION" --query taskArns > "$arns_file"
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
    --region "$AWS_REGION" > "$tasks_file"
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

record_rollback_configurations() {
  python3 - "$1" "$CUTOVER_STATE_DIR/deployment-configuration-original.json" \
    "$CUTOVER_STATE_DIR/deployment-configuration-disabled.json" <<'PY'
import copy, json, os, sys
source, original_path, disabled_path = sys.argv[1:4]
with open(source, encoding="utf-8") as fh:
    config = json.load(fh).get("deploymentConfiguration") or {}
disabled = copy.deepcopy(config)
disabled["deploymentCircuitBreaker"] = {"enable": False, "rollback": False}
if "alarms" in disabled:
    disabled["alarms"]["enable"] = False
    disabled["alarms"]["rollback"] = False
for path, value in ((original_path, config), (disabled_path, disabled)):
    with open(path, "x", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2, sort_keys=True); fh.write("\n")
    os.chmod(path, 0o600)
PY
}

assert_verification_group_attached() {
  local service_file="$1"
  local target_groups_file="$work_dir/target-groups.json"
  local load_balancers_file="$work_dir/load-balancers.json"
  local target_group_arns=()
  local load_balancer_arns=()
  while IFS= read -r arn; do
    [[ -n "$arn" ]] && target_group_arns+=("$arn")
  done < <(python3 - "$service_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: service = json.load(fh)
for item in service.get("loadBalancers") or []:
    if item.get("targetGroupArn"): print(item["targetGroupArn"])
PY
)
  if [[ "${#target_group_arns[@]}" -eq 0 ]]; then
    echo "The ECS service has no load-balancer target group to enforce the writer barrier." >&2
    return 1
  fi
  aws elbv2 describe-target-groups --target-group-arns "${target_group_arns[@]}" \
    --region "$AWS_REGION" > "$target_groups_file"
  while IFS= read -r arn; do
    [[ -n "$arn" ]] && load_balancer_arns+=("$arn")
  done < <(python3 - "$target_groups_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: groups = json.load(fh).get("TargetGroups") or []
for arn in sorted({arn for group in groups for arn in group.get("LoadBalancerArns") or []}): print(arn)
PY
)
  if [[ "${#load_balancer_arns[@]}" -eq 0 ]]; then
    echo "The ECS target group has no load balancer." >&2
    return 1
  fi
  aws elbv2 describe-load-balancers --load-balancer-arns "${load_balancer_arns[@]}" \
    --region "$AWS_REGION" > "$load_balancers_file"
  python3 - "$load_balancers_file" "$VERIFICATION_SECURITY_GROUP" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: load_balancers = json.load(fh).get("LoadBalancers") or []
expected = [sys.argv[2]]
if not load_balancers: raise SystemExit("No API load balancer was returned.")
for load_balancer in load_balancers:
    if load_balancer.get("SecurityGroups") != expected:
        raise SystemExit(f"Load balancer security groups are {load_balancer.get('SecurityGroups')}, expected sole group {expected}")
PY
}

record_and_install_writer_barrier() {
  local before="$CUTOVER_STATE_DIR/security-group-before.json"
  local removed="$CUTOVER_STATE_DIR/security-group-port-original.json"
  local barrier="$CUTOVER_STATE_DIR/security-group-port-barrier.json"
  describe_verification_group_to "$before"
  python3 - "$before" "$removed" "$barrier" "$VERIFICATION_CIDR" "$VERIFICATION_PORT" <<'PY'
import ipaddress, json, os, sys
source, removed_path, barrier_path, cidr, port = sys.argv[1:6]
cidr = str(ipaddress.ip_network(cidr, strict=False)); port = int(port)
with open(source, encoding="utf-8") as fh: groups = json.load(fh).get("SecurityGroups") or []
if len(groups) != 1: raise SystemExit("Could not record exactly one verification security group.")
removed = []
for permission in groups[0].get("IpPermissions") or []:
    protocol = permission.get("IpProtocol")
    if protocol == "-1" or (protocol in {"tcp", "6"} and permission.get("FromPort", -1) <= port <= permission.get("ToPort", -1)):
        removed.append(permission)
barrier = [{"IpProtocol": "tcp", "FromPort": port, "ToPort": port,
            "IpRanges": [{"CidrIp": cidr, "Description": "ScriptDeck cutover verification barrier"}]}]
for path, value in ((removed_path, removed), (barrier_path, barrier)):
    with open(path, "x", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2, sort_keys=True); fh.write("\n")
    os.chmod(path, 0o600)
PY
  if python3 - "$removed" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: raise SystemExit(0 if json.load(fh) else 1)
PY
  then
    aws ec2 revoke-security-group-ingress --group-id "$VERIFICATION_SECURITY_GROUP" \
      --ip-permissions "file://$removed" --region "$AWS_REGION" >/dev/null
  fi
  aws ec2 authorize-security-group-ingress --group-id "$VERIFICATION_SECURITY_GROUP" \
    --ip-permissions "file://$barrier" --region "$AWS_REGION" >/dev/null
  assert_writer_barrier
}

assert_original_writer_ingress_restored() {
  python3 - "$CUTOVER_STATE_DIR/security-group-before.json" "$1" "$VERIFICATION_PORT" <<'PY'
import json, sys
before_path, after_path, port = sys.argv[1:4]; port = int(port)
def covering(path):
    with open(path, encoding="utf-8") as fh: groups = json.load(fh).get("SecurityGroups") or []
    if len(groups) != 1: raise SystemExit("Could not compare exactly one verification security group.")
    result = []
    for permission in groups[0].get("IpPermissions") or []:
        protocol = permission.get("IpProtocol")
        if protocol == "-1" or (protocol in {"tcp", "6"} and permission.get("FromPort", -1) <= port <= permission.get("ToPort", -1)):
            result.append(permission)
    return sorted(result, key=lambda item: json.dumps(item, sort_keys=True))
if covering(before_path) != covering(after_path):
    raise SystemExit("Original verification-port ingress was not restored exactly.")
PY
}

restore_writer_barrier_exact() {
  local removed="$CUTOVER_STATE_DIR/security-group-port-original.json"
  local barrier="$CUTOVER_STATE_DIR/security-group-port-barrier.json"
  aws ec2 revoke-security-group-ingress --group-id "$VERIFICATION_SECURITY_GROUP" \
    --ip-permissions "file://$barrier" --region "$AWS_REGION" >/dev/null
  if python3 - "$removed" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: raise SystemExit(0 if json.load(fh) else 1)
PY
  then
    aws ec2 authorize-security-group-ingress --group-id "$VERIFICATION_SECURITY_GROUP" \
      --ip-permissions "file://$removed" --region "$AWS_REGION" >/dev/null
  fi
  describe_verification_group_to "$work_dir/security-group-restored.json"
  assert_original_writer_ingress_restored "$work_dir/security-group-restored.json"
}

assert_original_rollback_restored() {
  python3 - "$CUTOVER_STATE_DIR/deployment-configuration-original.json" "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: expected = json.load(fh)
with open(sys.argv[2], encoding="utf-8") as fh: actual = json.load(fh).get("deploymentConfiguration") or {}
if actual != expected: raise SystemExit(f"ECS deployment configuration was not restored exactly: {actual}")
PY
}

assert_snapshot_completed() {
  local snapshot_file="$work_dir/snapshot.json"
  aws rds describe-db-snapshots --db-snapshot-identifier "$CUTOVER_SNAPSHOT_ID" \
    --region "$AWS_REGION" --query 'DBSnapshots[0]' > "$snapshot_file"
  python3 - "$snapshot_file" "$CUTOVER_SNAPSHOT_ID" "$CUTOVER_DB_INSTANCE_ID" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: snapshot = json.load(fh)
if snapshot.get("DBSnapshotIdentifier") != sys.argv[2]: raise SystemExit("The requested cutover snapshot was not returned.")
if snapshot.get("DBInstanceIdentifier") != sys.argv[3]: raise SystemExit("The completed snapshot belongs to a different DB instance.")
if snapshot.get("Status") != "available": raise SystemExit(f"The cutover snapshot is not completed: {snapshot.get('Status')}")
if not snapshot.get("DBSnapshotArn"): raise SystemExit("The completed snapshot has no ARN.")
PY
  cp "$snapshot_file" "$CUTOVER_STATE_DIR/snapshot.json"
  chmod 600 "$CUTOVER_STATE_DIR/snapshot.json"
}

assert_s3_missing_404() {
  local error_file="$work_dir/head-object-error.txt"
  if aws s3api head-object --bucket "$REPORT_BUCKET" --key "$MIGRATION_REPORT_KEY" \
    --region "$AWS_REGION" > /dev/null 2> "$error_file"; then
    echo "S3 report still exists after deletion: s3://$REPORT_BUCKET/$MIGRATION_REPORT_KEY" >&2
    return 1
  fi
  if ! grep -Eq '\(404\)' "$error_file"; then
    echo "S3 report absence was not proved by a 404:" >&2
    sed -n '1,5p' "$error_file" >&2
    return 1
  fi
}

validate_conversion_report() {
  python3 - "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: report = json.load(fh)
if report.get("status") != "converted": raise SystemExit(f"Conversion report status is {report.get('status')}, expected converted")
if report.get("aborts") != []: raise SystemExit("Conversion report contains aborts.")
scanned = (report.get("scanned") or {}).get("captured_scenes")
converted = (report.get("converted") or {}).get("captured_scenes")
if not isinstance(scanned, int) or converted != scanned:
    raise SystemExit(f"Conversion count mismatch: scanned={scanned}, converted={converted}")
PY
}

write_cutover_authorization() {
  local path="$CUTOVER_STATE_DIR/cutover-authorization.json"
  python3 - "$path" "$TASK_DEFINITION_OVERRIDE" "$IMAGE_DIGEST" <<'PY'
import json
import os
import sys
path, task_definition, image_digest = sys.argv[1:4]
authorization = {
    "explicit_cutover": True,
    "service_zero_proved": True,
    "snapshot_completed_proved": True,
    "ecs_rollback_disabled_proved": True,
    "writer_barrier_proved": True,
    "task_definition": task_definition,
    "image_digest": image_digest,
    "consumed": False,
}
with open(path, "x", encoding="utf-8") as fh:
    json.dump(authorization, fh, indent=2, sort_keys=True)
    fh.write("\n")
os.chmod(path, 0o600)
PY
}

verify_backend() {
  echo "[INFO] Verifying backend health"
  curl -fsS "$API_HEALTH_URL"; echo
  echo "[INFO] Verifying backend smoke endpoint"
  curl -fsS "$API_SMOKE_URL" | python3 -c '
import json, sys
obj = json.load(sys.stdin)
if not isinstance(obj, list): raise SystemExit("Expected smoke endpoint to return a JSON array.")
print(f"[INFO] Smoke endpoint returned {len(obj)} item(s)")
'
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

write_cutover_manifest() {
  python3 - "$CUTOVER_STATE_DIR/cutover-state.json" "$AWS_REGION" "$ECS_CLUSTER" "$ECS_SERVICE" \
    "$TASK_DEFINITION_OVERRIDE" "$IMAGE_TAG" "$IMAGE_DIGEST" "$IMAGE_REF" "$RESUME_DESIRED_COUNT" \
    "$VERIFICATION_SECURITY_GROUP" "$VERIFICATION_CIDR" "$VERIFICATION_PORT" \
    "$CUTOVER_SNAPSHOT_ID" "$CUTOVER_DB_INSTANCE_ID" <<'PY'
import json, os, sys
keys = ("region", "cluster", "service", "task_definition", "image_tag", "image_digest", "image_ref",
        "resume_desired_count", "verification_security_group", "verification_cidr", "verification_port",
        "snapshot_id", "db_instance_id")
path, *values = sys.argv[1:]
value = dict(zip(keys, values, strict=True))
value["resume_desired_count"] = int(value["resume_desired_count"])
value["verification_port"] = int(value["verification_port"])
value["conversion_started"] = True
value["manual_verification_pending"] = True
with open(path, "x", encoding="utf-8") as fh:
    json.dump(value, fh, indent=2, sort_keys=True); fh.write("\n")
os.chmod(path, 0o600)
PY
}

load_cutover_manifest() {
  local assignments="$work_dir/cutover-state.assignments"
  python3 - "$CUTOVER_STATE_DIR/cutover-state.json" > "$assignments" <<'PY'
import json, shlex, sys
with open(sys.argv[1], encoding="utf-8") as fh: state = json.load(fh)
if state.get("manual_verification_pending") is not True or state.get("conversion_started") is not True:
    raise SystemExit("Cutover state is not awaiting manual verification completion.")
mapping = {"AWS_REGION": state["region"], "ECS_CLUSTER": state["cluster"], "ECS_SERVICE": state["service"],
           "TASK_DEFINITION_OVERRIDE": state["task_definition"], "IMAGE_TAG": state["image_tag"],
           "IMAGE_DIGEST": state["image_digest"], "IMAGE_REF": state["image_ref"],
           "RESUME_DESIRED_COUNT": str(state["resume_desired_count"]),
           "VERIFICATION_SECURITY_GROUP": state["verification_security_group"],
           "VERIFICATION_CIDR": state["verification_cidr"], "VERIFICATION_PORT": str(state["verification_port"])}
for name, value in mapping.items(): print(f"{name}={shlex.quote(value)}")
PY
  # This file contains only assignments emitted from the mode-0600 JSON state above.
  source "$assignments"
  export AWS_REGION
}

complete_cutover_safely() {
  load_cutover_manifest
  cutover_safety_engaged=1
  cutover_task_started=1
  describe_service_to "$work_dir/service-before-completion.json"
  assert_service_deployed_file "$work_dir/service-before-completion.json" \
    "$TASK_DEFINITION_OVERRIDE" "$RESUME_DESIRED_COUNT"
  assert_writer_barrier
  assert_rollback_disabled_file "$work_dir/service-before-completion.json"
  verify_running_task_digests "$TASK_DEFINITION_OVERRIDE" "$RESUME_DESIRED_COUNT"
  apply_deployment_configuration "$CUTOVER_STATE_DIR/deployment-configuration-original.json"
  describe_service_to "$work_dir/service-rollback-restored.json"
  assert_original_rollback_restored "$work_dir/service-rollback-restored.json"
  restore_writer_barrier_exact
  python3 - "$CUTOVER_STATE_DIR/cutover-state.json" "$VERIFICATION_RECORD" <<'PY'
import json, os, sys
path, verification_record = sys.argv[1:3]
with open(path, encoding="utf-8") as fh: state = json.load(fh)
state["manual_verification_pending"] = False
state["verification_record"] = os.path.abspath(verification_record)
temporary = path + ".tmp"
with open(temporary, "x", encoding="utf-8") as fh:
    json.dump(state, fh, indent=2, sort_keys=True); fh.write("\n")
os.chmod(temporary, 0o600); os.replace(temporary, path)
PY
  cutover_safety_engaged=0
  echo "[DONE] Cutover verification completed; ECS rollback settings and public ingress were restored."
}

if [[ "$complete_cutover" -eq 1 ]]; then
  complete_cutover_safely
  exit 0
fi

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

  if [[ "$cutover" -eq 1 ]]; then
    mkdir -m 700 "$CUTOVER_STATE_DIR"
    cp "$work_dir/service-before.json" "$CUTOVER_STATE_DIR/service-before.json"
    chmod 600 "$CUTOVER_STATE_DIR/service-before.json"
    assert_service_zero_file "$work_dir/service-before.json"
    cutover_safety_engaged=1
    assert_snapshot_completed
    assert_verification_group_attached "$work_dir/service-before.json"
    record_rollback_configurations "$work_dir/service-before.json"
    disable_cutover_rollback
    record_and_install_writer_barrier
    new_td="$TASK_DEFINITION_OVERRIDE"
    verify_task_definition_image "$new_td" "$work_dir/cutover-task-definition.json"
    validate_task_definition_database "$work_dir/cutover-task-definition.json"
    describe_service_to "$work_dir/service-immediately-before-conversion.json"
    assert_service_zero_file "$work_dir/service-immediately-before-conversion.json"
    assert_rollback_disabled_file "$work_dir/service-immediately-before-conversion.json"
    assert_writer_barrier
    assert_snapshot_completed
    write_cutover_authorization

    cutover_task_started=1
    set +e
    bash "$ROOT_DIR/infra/run-captured-scene-conversion.sh" \
      --region "$AWS_REGION" --ecs-cluster "$ECS_CLUSTER" --ecs-service "$ECS_SERVICE" \
      --task-definition "$new_td" --expected-image-digest "$IMAGE_DIGEST" \
      --task-status-file "$CUTOVER_STATE_DIR/conversion-task-status.json" \
      --cutover-authorization-file "$CUTOVER_STATE_DIR/cutover-authorization.json" \
      --report-key "$MIGRATION_REPORT_KEY" --convert-and-migrate
    conversion_status=$?
    set -e
    if [[ ! -s "$CUTOVER_STATE_DIR/conversion-task-status.json" ]]; then
      echo "Conversion task status was not persisted; schema state is unknown." >&2
      exit 1
    fi
    chmod 600 "$CUTOVER_STATE_DIR/conversion-task-status.json"
    if [[ "$conversion_status" -ne 0 ]]; then
      echo "Conversion task failed with status $conversion_status; schema state is unknown." >&2
      exit "$conversion_status"
    fi
    aws s3api get-object --bucket "$REPORT_BUCKET" --key "$MIGRATION_REPORT_KEY" \
      "$CUTOVER_STATE_DIR/conversion-report.json" --region "$AWS_REGION" >/dev/null
    chmod 600 "$CUTOVER_STATE_DIR/conversion-report.json"
    validate_conversion_report "$CUTOVER_STATE_DIR/conversion-report.json"
    aws s3api delete-object --bucket "$REPORT_BUCKET" --key "$MIGRATION_REPORT_KEY" \
      --region "$AWS_REGION" >/dev/null
    assert_s3_missing_404
  else
    current_td_json="$work_dir/task-definition-current.json"
    next_td_json="$work_dir/task-definition-next.json"
    aws ecs describe-task-definition --task-definition "$current_task_definition_arn" \
      --region "$AWS_REGION" --query taskDefinition > "$current_td_json"
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
  fi

  if [[ "$deploy_frontend" -eq 1 ]]; then deploy_frontend_artifact; fi
  desired_count="$current_desired_count"
  if [[ "$cutover" -eq 1 ]]; then desired_count="$RESUME_DESIRED_COUNT"; fi
  aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
    --task-definition "$new_td" --desired-count "$desired_count" --region "$AWS_REGION" >/dev/null
  aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION"
  describe_service_to "$work_dir/service-deployed.json"
  assert_service_deployed_file "$work_dir/service-deployed.json" "$new_td" "$desired_count"
  verify_running_task_digests "$new_td" "$desired_count"
  if [[ "$skip_verify" -eq 0 ]]; then
    if [[ "$cutover" -eq 1 ]]; then assert_writer_barrier; fi
    if ! verify_backend; then
      if [[ "$cutover" -eq 0 && "$run_migrations" -eq 0 && "$auto_rollback" -eq 1 ]]; then
        aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
          --task-definition "$current_task_definition_arn" --region "$AWS_REGION" >/dev/null
        aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --region "$AWS_REGION"
      fi
      exit 1
    fi
  fi
fi

if [[ "$deploy_frontend" -eq 1 && "$deploy_backend" -eq 0 ]]; then deploy_frontend_artifact; fi
if [[ "$skip_verify" -eq 0 && "$deploy_frontend" -eq 1 ]]; then verify_frontend; fi

if [[ "$cutover" -eq 1 ]]; then
  assert_writer_barrier
  describe_service_to "$work_dir/service-before-smoke.json"
  assert_rollback_disabled_file "$work_dir/service-before-smoke.json"
  "$VERIFICATION_COMMAND"
  assert_writer_barrier
  describe_service_to "$work_dir/service-after-smoke.json"
  assert_service_deployed_file "$work_dir/service-after-smoke.json" "$new_td" "$RESUME_DESIRED_COUNT"
  assert_rollback_disabled_file "$work_dir/service-after-smoke.json"
  verify_running_task_digests "$new_td" "$RESUME_DESIRED_COUNT"
  write_cutover_manifest
  echo "[DONE] Automated cutover checks passed. Restricted ingress and disabled ECS rollback remain enforced."
  echo "[NEXT] Complete the manual browser/viewer checks, record them, then run --complete-cutover."
else
  echo "[DONE] Deployment completed"
fi
