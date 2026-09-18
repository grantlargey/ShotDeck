#!/usr/bin/env bash

set -euo pipefail

arg_after() {
  local wanted="$1"
  shift
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "$wanted" ]]; then
      printf '%s\n' "${2:-}"
      return 0
    fi
    shift
  done
  return 1
}

fake_log() {
  printf '%s\n' "$1" >> "$FAKE_AWS_LOG"
}

fake_service_json() {
  local desired td config circuit_enable circuit_rollback alarm_enable alarm_rollback
  desired="$(<"$FAKE_STATE/desired")"
  td="$(<"$FAKE_STATE/task-definition")"
  config="$(<"$FAKE_STATE/rollback")"
  if [[ "$config" == "original" ]]; then
    circuit_enable=true
    circuit_rollback=true
    alarm_enable=true
    alarm_rollback=true
  else
    circuit_enable=false
    circuit_rollback=false
    alarm_enable=false
    alarm_rollback=false
  fi
  printf '{"desiredCount":%s,"runningCount":%s,"pendingCount":0,"taskDefinition":"%s","networkConfiguration":{"awsvpcConfiguration":{"subnets":["subnet-test"],"securityGroups":["sg-task"]}},"launchType":"FARGATE","capacityProviderStrategy":[],"loadBalancers":[{"targetGroupArn":"arn:target-group"}],"deploymentConfiguration":{"minimumHealthyPercent":100,"maximumPercent":200,"deploymentCircuitBreaker":{"enable":%s,"rollback":%s},"alarms":{"alarmNames":["api-alarm"],"enable":%s,"rollback":%s}},"deployments":[{"status":"PRIMARY","rolloutState":"COMPLETED","taskDefinition":"%s"}]}\n' \
    "$desired" "$desired" "$td" "$circuit_enable" "$circuit_rollback" \
    "$alarm_enable" "$alarm_rollback" "$td"
}

fake_task_definition_json() {
  local requested image
  requested="$1"
  image="$FAKE_IMAGE_REF"
  if [[ "$requested" == "$FAKE_OLD_TD" ]]; then image="example.invalid/shotdeck-api:old"; fi
  printf '{"family":"shotdeck-api","taskDefinitionArn":"%s","containerDefinitions":[{"name":"api","image":"%s","environment":[{"name":"DATABASE_URL","value":"postgres://user:password@db.example/shotdeck"},{"name":"PORT","value":"3000"}],"logConfiguration":{"options":{"awslogs-group":"/ecs/test","awslogs-stream-prefix":"ecs"}}}]}\n' \
    "$requested" "$image"
}

fake_aws() {
  local service="${1:-}" operation="${2:-}"
  shift 2 || true
  case "$service $operation" in
    "ecr describe-images")
      fake_log ECR_DIGEST
      printf '%s\n' "${FAKE_ECR_DIGEST:-$FAKE_IMAGE_DIGEST}"
      ;;
    "ecs describe-services")
      fake_log DESCRIBE_SERVICE
      fake_service_json
      ;;
    "ecs update-service")
      local desired="" td="" config_file=""
      desired="$(arg_after --desired-count "$@" 2>/dev/null || true)"
      td="$(arg_after --task-definition "$@" 2>/dev/null || true)"
      config_file="$(arg_after --deployment-configuration "$@" 2>/dev/null || true)"
      if [[ -n "$config_file" ]]; then
        config_file="${config_file#file://}"
        if python3 - "$config_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: config = json.load(fh)
circuit = config.get("deploymentCircuitBreaker") or {}
alarms = config.get("alarms")
disabled = circuit.get("enable") is False and circuit.get("rollback") is False
disabled = disabled and (alarms is None or (alarms.get("enable") is False and alarms.get("rollback") is False))
raise SystemExit(0 if disabled else 1)
PY
        then
          printf '%s\n' disabled > "$FAKE_STATE/rollback"
          fake_log DISABLE_ROLLBACK
        else
          printf '%s\n' original > "$FAKE_STATE/rollback"
          fake_log RESTORE_ROLLBACK
        fi
      fi
      if [[ -n "$td" ]]; then printf '%s\n' "$td" > "$FAKE_STATE/task-definition"; fi
      if [[ -n "$desired" ]]; then
        printf '%s\n' "$desired" > "$FAKE_STATE/desired"
        if [[ "$desired" == "0" ]]; then fake_log SERVICE_ZERO; else fake_log SERVICE_DEPLOY; fi
      fi
      printf '{}\n'
      ;;
    "ecs wait")
      fake_log ECS_WAIT
      ;;
    "ecs describe-task-definition")
      local requested
      requested="$(arg_after --task-definition "$@")"
      fake_log "DESCRIBE_TD:$requested"
      fake_task_definition_json "$requested"
      ;;
    "ecs run-task")
      fake_log RUN_CONVERSION_TASK
      python3 - "$TMPDIR" "$FAKE_STATE/secure-temp-ok" <<'PY'
import os, stat, sys
root, marker = sys.argv[1:3]
matches = []
for directory, _, files in os.walk(root):
    if "task-definition.json" in files:
        matches.append(os.path.join(directory, "task-definition.json"))
if len(matches) != 1:
    raise SystemExit(f"Expected one task-definition temp file, found {matches}")
path = matches[0]
if stat.S_IMODE(os.stat(path).st_mode) != 0o600:
    raise SystemExit("Task-definition temp file is not mode 0600")
if stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode) != 0o700:
    raise SystemExit("Task-definition temp directory is not mode 0700")
with open(marker, "w", encoding="utf-8") as fh: fh.write("ok\n")
PY
      printf '{"failures":[],"tasks":[{"taskArn":"arn:aws:ecs:test:task/conversion"}]}\n'
      ;;
    "ecs describe-tasks")
      local query
      query="$(arg_after --query "$@" 2>/dev/null || true)"
      if [[ "$query" == *exitCode* ]]; then
        printf '%s\n' "${FAKE_TASK_EXIT_CODE:-0}"
      elif [[ "$query" == *stoppedReason* ]]; then
        printf 'Essential container exited\n'
      elif [[ "$query" == *imageDigest* ]]; then
        printf '%s\n' "${FAKE_TASK_DIGEST:-$FAKE_IMAGE_DIGEST}"
      else
        local desired td i
        desired="$(<"$FAKE_STATE/desired")"
        td="$(<"$FAKE_STATE/task-definition")"
        printf '{"failures":[],"tasks":['
        for ((i=1; i<=desired; i++)); do
          if (( i > 1 )); then printf ','; fi
          printf '{"taskDefinitionArn":"%s","containers":[{"name":"api","imageDigest":"%s"}]}' \
            "$td" "${FAKE_TASK_DIGEST:-$FAKE_IMAGE_DIGEST}"
        done
        printf ']}\n'
      fi
      ;;
    "ecs list-tasks")
      local desired i
      desired="$(<"$FAKE_STATE/desired")"
      printf '['
      for ((i=1; i<=desired; i++)); do
        if (( i > 1 )); then printf ','; fi
        printf '"arn:aws:ecs:test:task/api-%s"' "$i"
      done
      printf ']\n'
      ;;
    "logs get-log-events")
      printf '{"events":[{"message":"offline conversion stub"}]}\n'
      ;;
    "rds describe-db-snapshots")
      fake_log SNAPSHOT_CHECK
      printf '{"DBSnapshotIdentifier":"snapshot-test","DBInstanceIdentifier":"db-test","Status":"%s","DBSnapshotArn":"arn:snapshot-test"}\n' \
        "${FAKE_SNAPSHOT_STATUS:-available}"
      ;;
    "elbv2 describe-target-groups")
      fake_log LOAD_BALANCER_TARGET
      printf '{"TargetGroups":[{"LoadBalancerArns":["arn:load-balancer"]}]}\n'
      ;;
    "elbv2 describe-load-balancers")
      printf '{"LoadBalancers":[{"LoadBalancerArn":"arn:load-balancer","SecurityGroups":["sg-verification"]}]}\n'
      ;;
    "ec2 describe-security-groups")
      local sg_mode
      sg_mode="$(<"$FAKE_STATE/security-group")"
      if [[ "$sg_mode" == "original" ]]; then
        printf '{"SecurityGroups":[{"GroupId":"sg-verification","IpPermissions":[{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]}]}\n'
      elif [[ "$sg_mode" == "barrier" ]]; then
        printf '{"SecurityGroups":[{"GroupId":"sg-verification","IpPermissions":[{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"198.51.100.24/32","Description":"ScriptDeck cutover verification barrier"}]}]}]}\n'
      else
        printf '{"SecurityGroups":[{"GroupId":"sg-verification","IpPermissions":[]}]}\n'
      fi
      ;;
    "ec2 revoke-security-group-ingress")
      local permissions
      permissions="$(arg_after --ip-permissions "$@")"
      permissions="${permissions#file://}"
      printf '%s\n' none > "$FAKE_STATE/security-group"
      if [[ "$permissions" == *barrier* ]]; then fake_log REVOKE_BARRIER; else fake_log REVOKE_PUBLIC; fi
      printf '{}\n'
      ;;
    "ec2 authorize-security-group-ingress")
      local permissions
      permissions="$(arg_after --ip-permissions "$@")"
      permissions="${permissions#file://}"
      if [[ "$permissions" == *barrier* ]]; then
        printf '%s\n' barrier > "$FAKE_STATE/security-group"
        fake_log AUTHORIZE_BARRIER
      else
        printf '%s\n' original > "$FAKE_STATE/security-group"
        fake_log RESTORE_PUBLIC
      fi
      printf '{}\n'
      ;;
    "s3api get-object")
      fake_log GET_CONVERSION_REPORT
      if [[ ! -s "$FAKE_CUTOVER_STATE_DIR/conversion-task-status.json" ]]; then
        echo "task status was not persisted before report retrieval" >&2
        return 42
      fi
      local destination=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --bucket|--key|--region) shift 2 ;;
          --*) shift ;;
          *) destination="$1"; shift ;;
        esac
      done
      printf '%s\n' '{"status":"converted","scanned":{"captured_scenes":1},"converted":{"captured_scenes":1},"aborts":[]}' > "$destination"
      printf '{}\n'
      ;;
    "s3api delete-object")
      fake_log DELETE_CONVERSION_REPORT
      printf '%s\n' deleted > "$FAKE_STATE/report"
      printf '{}\n'
      ;;
    "s3api head-object")
      local key
      key="$(arg_after --key "$@")"
      if [[ "$key" == "index.html" ]]; then
        printf '{"CacheControl":"no-cache","ContentType":"text/html"}\n'
      elif [[ "$(<"$FAKE_STATE/report")" == "deleted" ]]; then
        if [[ "${FAKE_HEAD_ERROR:-404}" == "404" ]]; then
          echo "An error occurred (404) when calling the HeadObject operation: Not Found" >&2
        else
          echo "An error occurred (${FAKE_HEAD_ERROR}) when calling the HeadObject operation: Forbidden" >&2
        fi
        return 255
      else
        printf '{}\n'
      fi
      ;;
    "s3 sync") fake_log FRONTEND_SYNC ;;
    "s3 cp") fake_log FRONTEND_INDEX ;;
    "cloudfront create-invalidation") fake_log CLOUDFRONT_INVALIDATION ;;
    "ecs register-task-definition") printf '%s\n' "$FAKE_NEW_TD" ;;
    *)
      echo "Unhandled fake aws command: $service $operation $*" >&2
      return 99
      ;;
  esac
}

dispatch="${0##*/}"
if [[ "$dispatch" == "aws" ]]; then fake_aws "$@"; exit $?; fi
if [[ "$dispatch" == "curl" ]]; then
  fake_log CURL_VERIFY
  if [[ "${*: -1}" == *movies* ]]; then
    printf '[]\n'
  elif [[ "${*: -1}" == *scriptdeckdemo.com* && "${*: -1}" != *api.* ]]; then
    sed -n '1,200p' "$SHOTDECK_FRONTEND_DIST_DIR/index.html"
  else
    printf '{"status":"ok"}\n'
  fi
  exit 0
fi
if [[ "$dispatch" == "cutover-smoke" ]]; then
  fake_log ISSUE16_SMOKE
  exit "${FAKE_HOOK_STATUS:-0}"
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT_DIR/infra/deploy-prod.sh"
RUNNER="$ROOT_DIR/infra/run-api-task.sh"
CONVERSION="$ROOT_DIR/infra/run-captured-scene-conversion.sh"
DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OLD_TD="arn:aws:ecs:test:task-definition/old:1"
NEW_TD="arn:aws:ecs:test:task-definition/new:2"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/shotdeck-cutover-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FAKE_BIN" "$TEST_ROOT/tmp" "$TEST_ROOT/dist"
ln -s "$ROOT_DIR/infra/test-cutover-safety.sh" "$FAKE_BIN/aws"
ln -s "$ROOT_DIR/infra/test-cutover-safety.sh" "$FAKE_BIN/curl"
ln -s "$ROOT_DIR/infra/test-cutover-safety.sh" "$FAKE_BIN/cutover-smoke"
printf '<html><script src="/assets/test.js"></script></html>\n' > "$TEST_ROOT/dist/index.html"

export PATH="$FAKE_BIN:$PATH"
export TMPDIR="$TEST_ROOT/tmp"
export SHOTDECK_FRONTEND_DIST_DIR="$TEST_ROOT/dist"
export FAKE_IMAGE_DIGEST="$DIGEST"
export FAKE_IMAGE_REF="718484332261.dkr.ecr.us-east-1.amazonaws.com/shotdeck-api@$DIGEST"
export FAKE_OLD_TD="$OLD_TD"
export FAKE_NEW_TD="$NEW_TD"

pass_count=0
pass() {
  pass_count=$((pass_count + 1))
  printf 'ok %s - %s\n' "$pass_count" "$1"
}

fail() {
  echo "not ok - $1" >&2
  exit 1
}

expect_failure() {
  local expected="$1"
  shift
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 || "$output" != *"$expected"* ]]; then
    echo "$output" >&2
    fail "expected failure containing: $expected"
  fi
}

new_case() {
  local name="$1" desired="$2"
  export FAKE_STATE="$TEST_ROOT/$name-state"
  export FAKE_AWS_LOG="$TEST_ROOT/$name-aws.log"
  export FAKE_CUTOVER_STATE_DIR="$TEST_ROOT/$name-cutover"
  mkdir -p "$FAKE_STATE"
  : > "$FAKE_AWS_LOG"
  printf '%s\n' "$desired" > "$FAKE_STATE/desired"
  printf '%s\n' "$OLD_TD" > "$FAKE_STATE/task-definition"
  printf '%s\n' original > "$FAKE_STATE/rollback"
  printf '%s\n' original > "$FAKE_STATE/security-group"
  printf '%s\n' present > "$FAKE_STATE/report"
  unset FAKE_ECR_DIGEST FAKE_TASK_DIGEST FAKE_TASK_EXIT_CODE FAKE_HEAD_ERROR FAKE_HOOK_STATUS FAKE_SNAPSHOT_STATUS
}

cutover_args() {
  CUTOVER_ARGS=(
    --cutover --skip-build --prebuilt-frontend
    --image-tag git-deadbee-20260918 --image-digest "$DIGEST"
    --task-definition "$NEW_TD"
    --cutover-snapshot-id snapshot-test --cutover-db-instance-id db-test
    --cutover-state-dir "$FAKE_CUTOVER_STATE_DIR" --resume-desired-count 1
    --verification-security-group sg-verification --verification-cidr 198.51.100.24/32
    --verification-port 443 --verification-command "$FAKE_BIN/cutover-smoke"
    --report-bucket report-bucket --migration-report-key ops/inventory/cutover-test.json
  )
}

assert_no_event() {
  if grep -Fq "$1" "$FAKE_AWS_LOG"; then fail "unexpected event $1"; fi
}

assert_order() {
  local last=0 event line
  for event in "$@"; do
    line="$(grep -n -m1 -F "$event" "$FAKE_AWS_LOG" | cut -d: -f1 || true)"
    if [[ -z "$line" || "$line" -le "$last" ]]; then
      echo "Event log:" >&2
      sed -n '1,200p' "$FAKE_AWS_LOG" >&2
      fail "event order at $event"
    fi
    last="$line"
  done
}

assert_secure_state() {
  python3 - "$1" <<'PY'
import os, stat, sys
root = sys.argv[1]
if stat.S_IMODE(os.stat(root).st_mode) != 0o700:
    raise SystemExit("cutover state directory is not mode 0700")
for name in os.listdir(root):
    path = os.path.join(root, name)
    if os.path.isfile(path) and stat.S_IMODE(os.stat(path).st_mode) != 0o600:
        raise SystemExit(f"{name} is not mode 0600")
PY
}

assert_temp_clean() {
  if find "$TEST_ROOT/tmp" -mindepth 1 -maxdepth 1 \( -name 'shotdeck-deploy.*' -o -name 'shotdeck-run-task.*' \) | grep -q .; then
    fail "secure temporary directories were not cleaned"
  fi
}

bash -n "$DEPLOY"
bash -n "$RUNNER"
bash -n "$CONVERSION"
pass "shell syntax"

new_case refusals 0
expect_failure "monolithic ECR uploader" bash "$DEPLOY" --image-tag test --image-digest "$DIGEST"
cutover_args
expect_failure "forbids --skip-migrations" bash "$DEPLOY" "${CUTOVER_ARGS[@]}" --skip-migrations
expect_failure "internal to deploy-prod.sh --cutover" bash "$CONVERSION" \
  --task-definition "$NEW_TD" --report-key ops/inventory/direct.json --convert-and-migrate
mkdir -p "$FAKE_CUTOVER_STATE_DIR"
expect_failure "nonempty --verification-record" bash "$DEPLOY" \
  --complete-cutover --cutover-state-dir "$FAKE_CUTOVER_STATE_DIR"
pass "unsafe option paths are refused"

new_case success 0
cutover_args
FAKE_HOOK_STATUS=0 bash "$DEPLOY" "${CUTOVER_ARGS[@]}"
[[ "$(<"$FAKE_STATE/desired")" == 1 ]] || fail "cutover service did not reach verification count"
[[ "$(<"$FAKE_STATE/task-definition")" == "$NEW_TD" ]] || fail "cutover service did not use probed task definition"
[[ "$(<"$FAKE_STATE/rollback")" == disabled ]] || fail "rollback paths restored before manual verification"
[[ "$(<"$FAKE_STATE/security-group")" == barrier ]] || fail "writer barrier restored before manual verification"
[[ -s "$FAKE_STATE/secure-temp-ok" ]] || fail "secure task-definition temp handling was not observed"
[[ -s "$FAKE_CUTOVER_STATE_DIR/conversion-task-status.json" ]] || fail "task status missing"
assert_secure_state "$FAKE_CUTOVER_STATE_DIR"
assert_order ECR_DIGEST SNAPSHOT_CHECK DISABLE_ROLLBACK REVOKE_PUBLIC AUTHORIZE_BARRIER \
  RUN_CONVERSION_TASK GET_CONVERSION_REPORT DELETE_CONVERSION_REPORT FRONTEND_SYNC SERVICE_DEPLOY ISSUE16_SMOKE
expect_failure "consumed=False" bash "$CONVERSION" --task-definition "$NEW_TD" \
  --expected-image-digest "$DIGEST" --task-status-file "$TEST_ROOT/reuse-task-status.json" \
  --cutover-authorization-file "$FAKE_CUTOVER_STATE_DIR/cutover-authorization.json" \
  --report-key ops/inventory/reuse.json --convert-and-migrate
assert_temp_clean
pass "successful cutover preserves pinned restricted verification state and one-use authorization"

events_before="$(wc -l < "$FAKE_AWS_LOG")"
expect_failure "nonempty --verification-record" bash "$DEPLOY" \
  --complete-cutover --cutover-state-dir "$FAKE_CUTOVER_STATE_DIR"
[[ "$(wc -l < "$FAKE_AWS_LOG")" == "$events_before" ]] || fail "completion touched AWS without verification record"
: > "$TEST_ROOT/empty-verification.txt"
expect_failure "nonempty --verification-record" bash "$DEPLOY" --complete-cutover \
  --cutover-state-dir "$FAKE_CUTOVER_STATE_DIR" --verification-record "$TEST_ROOT/empty-verification.txt"
printf 'issue-16 smoke and manual browser/viewer checks passed\n' > "$TEST_ROOT/verification.txt"
bash "$DEPLOY" --complete-cutover --cutover-state-dir "$FAKE_CUTOVER_STATE_DIR" \
  --verification-record "$TEST_ROOT/verification.txt"
[[ "$(<"$FAKE_STATE/rollback")" == original ]] || fail "rollback settings were not restored"
[[ "$(<"$FAKE_STATE/security-group")" == original ]] || fail "public ingress was not restored"
python3 - "$FAKE_CUTOVER_STATE_DIR/cutover-state.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh: state = json.load(fh)
if state.get("manual_verification_pending") is not False: raise SystemExit("completion state was not recorded")
PY
assert_order ISSUE16_SMOKE RESTORE_ROLLBACK REVOKE_BARRIER RESTORE_PUBLIC
assert_temp_clean
pass "completion requires evidence and restores protections only afterward"

new_case writers_running 1
cutover_args
expect_failure "API writers are not stopped" bash "$DEPLOY" "${CUTOVER_ARGS[@]}"
assert_no_event RUN_CONVERSION_TASK
pass "cutover refuses nonzero desired/running service counts"

new_case snapshot_incomplete 0
export FAKE_SNAPSHOT_STATUS=creating
cutover_args
expect_failure "snapshot is not completed" bash "$DEPLOY" "${CUTOVER_ARGS[@]}"
assert_no_event RUN_CONVERSION_TASK
pass "cutover refuses an incomplete snapshot"

new_case digest_mismatch 0
export FAKE_ECR_DIGEST="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
cutover_args
expect_failure "resolves to" bash "$DEPLOY" "${CUTOVER_ARGS[@]}"
assert_no_event RUN_CONVERSION_TASK
pass "cutover refuses a mutable-tag digest mismatch"

new_case verification_failure 0
export FAKE_HOOK_STATUS=7
cutover_args
expect_failure "schema is unknown" bash "$DEPLOY" "${CUTOVER_ARGS[@]}"
[[ "$(<"$FAKE_STATE/desired")" == 0 ]] || fail "verification failure did not force service zero"
[[ "$(<"$FAKE_STATE/rollback")" == disabled ]] || fail "verification failure did not leave rollback disabled"
[[ "$(<"$FAKE_STATE/security-group")" == barrier ]] || fail "verification failure removed writer barrier"
assert_order RUN_CONVERSION_TASK ISSUE16_SMOKE SERVICE_ZERO
pass "post-conversion failure forces and proves zero with protections retained"

new_case deletion_forbidden 0
export FAKE_HEAD_ERROR=403
cutover_args
expect_failure "not proved by a 404" bash "$DEPLOY" "${CUTOVER_ARGS[@]}"
[[ "$(<"$FAKE_STATE/desired")" == 0 ]] || fail "report-deletion uncertainty did not keep service zero"
pass "only a confirmed 404 proves report deletion"

new_case task_digest_mismatch 0
export FAKE_TASK_DIGEST="sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
cutover_args
expect_failure "schema is unknown" bash "$DEPLOY" "${CUTOVER_ARGS[@]}"
[[ -s "$FAKE_CUTOVER_STATE_DIR/conversion-task-status.json" ]] || fail "digest mismatch lost task status"
[[ "$(<"$FAKE_STATE/desired")" == 0 ]] || fail "task digest mismatch did not force zero"
pass "task digest mismatch is recorded and fails closed"

printf '1..%s\n' "$pass_count"
