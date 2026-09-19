#!/usr/bin/env bash

# Runs the one-use captured-scene converter through run-api-task.sh and saves
# its counts-and-IDs-only JSON report in the API task's S3 bucket. The report
# is uploaded before the converter's exit code is returned. In cutover mode,
# migrations run in the same ECS task only after a successful conversion.

set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: bash infra/run-captured-scene-conversion.sh [options] --check
       bash infra/run-captured-scene-conversion.sh [options] --migrate-check
       bash infra/run-captured-scene-conversion.sh [options] --extension-check
       bash infra/run-captured-scene-conversion.sh [options] --convert-and-migrate

Options:
  --region REGION           AWS region override
  --ecs-cluster NAME        ECS cluster override
  --ecs-service NAME        ECS service override
  --task-definition ARN     Task definition to run (required)
  --expected-image-digest D Require the task definition and task to use sha256 digest D
  --task-status-file PATH   Save the ECS task status locally before report retrieval
  --cutover-authorization-file PATH
                            Internal mode-0600 proof emitted by deploy-prod.sh --cutover
  --report-key KEY          New ops/inventory/*.json S3 key (required)
  --check                   Read-only conversion check
  --migrate-check           Prove the legacy-schema migration refusal
  --extension-check         Check btree_gist availability and CREATE permission
  --convert-and-migrate     Convert, then run migrations in the same task
  -h, --help                Show this help

Converter modes preserve its exit codes 0 through 4. The migration check
preserves migrate.js's expected nonzero exit. The extension check exits 3 when
btree_gist is unavailable or the role cannot create it. Exit 5 means a JSON
report was missing, invalid or could not be written without overwriting an
existing key. Runner failures exit 1.
EOF
}

DEPLOY_REGION=""
ECS_CLUSTER_OVERRIDE=""
ECS_SERVICE_OVERRIDE=""
TASK_DEFINITION=""
EXPECTED_IMAGE_DIGEST=""
TASK_STATUS_FILE=""
CUTOVER_AUTHORIZATION_FILE=""
REPORT_KEY=""
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) DEPLOY_REGION="${2:-}"; shift 2 ;;
    --ecs-cluster) ECS_CLUSTER_OVERRIDE="${2:-}"; shift 2 ;;
    --ecs-service) ECS_SERVICE_OVERRIDE="${2:-}"; shift 2 ;;
    --task-definition) TASK_DEFINITION="${2:-}"; shift 2 ;;
    --expected-image-digest) EXPECTED_IMAGE_DIGEST="${2:-}"; shift 2 ;;
    --task-status-file) TASK_STATUS_FILE="${2:-}"; shift 2 ;;
    --cutover-authorization-file) CUTOVER_AUTHORIZATION_FILE="${2:-}"; shift 2 ;;
    --report-key) REPORT_KEY="${2:-}"; shift 2 ;;
    --check|--migrate-check|--extension-check|--convert-and-migrate)
      if [[ -n "$MODE" ]]; then
        echo "Choose exactly one task mode." >&2
        exit 1
      fi
      MODE="$1"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$TASK_DEFINITION" || -z "$REPORT_KEY" || -z "$MODE" ]]; then
  echo "--task-definition, --report-key and one mode are required." >&2
  usage >&2
  exit 1
fi

if [[ ! "$REPORT_KEY" =~ ^ops/inventory/[A-Za-z0-9._/-]+\.json$ ]] || [[ "$REPORT_KEY" == *..* ]]; then
  echo "--report-key must be a safe, new ops/inventory/*.json key." >&2
  exit 1
fi

if [[ "$MODE" == "--convert-and-migrate" ]]; then
  if [[ -z "$CUTOVER_AUTHORIZATION_FILE" || -z "$EXPECTED_IMAGE_DIGEST" || -z "$TASK_STATUS_FILE" ]]; then
    echo "--convert-and-migrate is internal to deploy-prod.sh --cutover and requires its authorization, digest and task-status file." >&2
    exit 1
  fi
  python3 - "$CUTOVER_AUTHORIZATION_FILE" "$TASK_DEFINITION" "$EXPECTED_IMAGE_DIGEST" <<'PY'
import json
import os
import stat
import sys

path, expected_task_definition, expected_digest = sys.argv[1:4]
mode = stat.S_IMODE(os.stat(path).st_mode)
if mode != 0o600:
    raise SystemExit(f"Cutover authorization must have mode 0600, found {mode:04o}.")
with open(path, encoding="utf-8") as fh:
    authorization = json.load(fh)
required = {
    "explicit_cutover": True,
    "service_zero_proved": True,
    "snapshot_completed_proved": True,
    "ecs_rollback_disabled_proved": True,
    "writer_barrier_proved": True,
    "task_definition": expected_task_definition,
    "image_digest": expected_digest,
    "consumed": False,
}
for key, value in required.items():
    if authorization.get(key) != value:
        raise SystemExit(f"Cutover authorization does not prove {key}={value!r}.")
authorization["consumed"] = True
temporary = path + ".tmp"
with open(temporary, "x", encoding="utf-8") as fh:
    json.dump(authorization, fh, indent=2, sort_keys=True)
    fh.write("\n")
os.chmod(temporary, 0o600)
os.replace(temporary, path)
PY
elif [[ -n "$CUTOVER_AUTHORIZATION_FILE" ]]; then
  echo "--cutover-authorization-file is valid only with --convert-and-migrate." >&2
  exit 1
fi

runner_args=()
if [[ -n "$DEPLOY_REGION" ]]; then runner_args+=(--region "$DEPLOY_REGION"); fi
if [[ -n "$ECS_CLUSTER_OVERRIDE" ]]; then runner_args+=(--ecs-cluster "$ECS_CLUSTER_OVERRIDE"); fi
if [[ -n "$ECS_SERVICE_OVERRIDE" ]]; then runner_args+=(--ecs-service "$ECS_SERVICE_OVERRIDE"); fi
if [[ -n "$EXPECTED_IMAGE_DIGEST" ]]; then
  runner_args+=(--expected-image-digest "$EXPECTED_IMAGE_DIGEST")
fi
if [[ -n "$TASK_STATUS_FILE" ]]; then runner_args+=(--status-file "$TASK_STATUS_FILE"); fi

read -r -d '' task_script <<'SH' || true
umask 077
task_dir="$(mktemp -d /tmp/captured-scene-conversion.XXXXXX)"
trap 'rm -rf "$task_dir"' EXIT
report_file="$task_dir/report.json"
if [ "$2" = "--check" ]; then
  node src/tools/convert-captured-scenes.js --check > "$report_file"
  converter_status=$?
elif [ "$2" = "--migrate-check" ]; then
  stdout_file="$task_dir/migrate.stdout"
  stderr_file="$task_dir/migrate.stderr"
  node src/migrate.js > "$stdout_file" 2> "$stderr_file"
  converter_status=$?
  cat "$stdout_file"
  cat "$stderr_file" >&2
  if [ "$converter_status" -ne 0 ] && grep -Fq "This database predates the canonical schema; run node src/tools/convert-captured-scenes.js first." "$stderr_file"; then
    printf '%s\n' '{"status":"expected_legacy_schema_refusal"}' > "$report_file"
  else
    printf '{"status":"unexpected_migration_result","exit_code":%s}\n' "$converter_status" > "$report_file"
    if [ "$converter_status" -eq 0 ]; then converter_status=3; fi
  fi
elif [ "$2" = "--extension-check" ]; then
  node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("rds.amazonaws.com")
        ? { rejectUnauthorized: false }
        : false,
    });
    try {
      await client.connect();
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(`
        SELECT EXISTS (
                 SELECT 1 FROM pg_available_extensions WHERE name = $$btree_gist$$
               ) AS available,
               EXISTS (
                 SELECT 1 FROM pg_extension WHERE extname = $$btree_gist$$
               ) AS installed,
               has_database_privilege(current_user, current_database(), $$CREATE$$) AS can_create
      `);
      await client.query("ROLLBACK");
      const check = result.rows[0];
      const ok = check.available && (check.installed || check.can_create);
      console.log(JSON.stringify({ status: ok ? "ok" : "stop", btree_gist: check }));
      process.exitCode = ok ? 0 : 3;
    } catch (error) {
      console.error(`btree_gist check failed: ${error?.message || "database error"}`);
      process.exitCode = 4;
    } finally {
      await client.end().catch(() => {});
    }
  ' > "$report_file"
  converter_status=$?
else
  node src/tools/convert-captured-scenes.js > "$report_file"
  converter_status=$?
fi

if [ -s "$report_file" ]; then
  cat "$report_file"
  node --input-type=module -e '
    import fs from "node:fs/promises";
    import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

    const [reportPath, key] = process.argv.slice(1);
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("The task definition has no S3_BUCKET.");
    const body = await fs.readFile(reportPath, "utf8");
    JSON.parse(body);
    const client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      CacheControl: "no-store",
      IfNoneMatch: "*",
    }));
  ' "$report_file" "$1"
  report_status=$?
else
  report_status=5
fi

if [ "$converter_status" -ne 0 ]; then
  if [ -s "$report_file" ] && [ "$report_status" -ne 0 ]; then exit 5; fi
  exit "$converter_status"
fi
if [ "$report_status" -ne 0 ]; then exit 5; fi

if [ "$2" = "--convert-and-migrate" ]; then
  node src/migrate.js
fi
SH

bash "$ROOT_DIR/infra/run-api-task.sh" \
  "${runner_args[@]}" \
  --task-definition "$TASK_DEFINITION" \
  -- sh -c "$task_script" captured-scene-conversion "$REPORT_KEY" "$MODE"
