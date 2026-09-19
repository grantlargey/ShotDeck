import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const serverDir = path.join(root, "server");
const approvedDump =
  "/Users/grantlargey/Desktop/Projects/ShotDeck/ShotDeck/.scratch/codebase-overhaul/local-legacy/shotdeck-legacy-20260916.dump";
const approvedDumpSha256 = "58d110397dbd59aaf06f6453af9ca77a1e914b87d8dfd242aab55f17cae60bb1";
const localSceneIds = [
  "0075ae75-93c7-4143-aef6-b4e29574ed20",
  "699a57ac-4d59-4a29-b930-75d064b3072c",
  "e12dfd87-1711-476c-8506-0ea53959272b",
];

await import(pathToFileURL(path.join(root, "test/browser-smoke/block-external-network.mjs")));
const requireServer = createRequire(path.join(serverDir, "package.json"));
const { Client } = requireServer("pg");

const adminUrl = new URL(
  process.env.CUTOVER_DRY_RUN_DATABASE_ADMIN_URL ||
    process.env.SMOKE_DATABASE_ADMIN_URL ||
    "postgres://app:app@127.0.0.1:5432/postgres"
);
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const runId = `${process.pid}_${randomBytes(3).toString("hex")}`;
const databaseNames = {
  converted: `shotdeck_test_18_dry_${runId}`,
  fresh: `shotdeck_test_18_fresh_${runId}`,
};
const createdDatabases = new Set();
const blockerUrl = pathToFileURL(path.join(root, "test/browser-smoke/block-external-network.mjs")).href;
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "shotdeck-cutover-dry-run-"));
const reportPath = path.join(temporaryDirectory, "conversion-report.json");

let apiServer;
let appPool;
let activeChild;
let interruptedSignal;

class DryRunInterrupted extends Error {}

function throwIfInterrupted() {
  if (interruptedSignal) throw new DryRunInterrupted(`Local cutover dry run interrupted by ${interruptedSignal}.`);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    process.exitCode = 1;
    console.error(`Received ${signal}; requesting local cutover dry-run cleanup.`);
    activeChild?.kill(signal);
  });
}

function pass(message) {
  throwIfInterrupted();
  console.log(`PASS ${message}`);
}

function assertSafeDatabaseName(name) {
  assert.match(name, /^shotdeck_test_18_[a-z0-9_]+$/, `Refusing unsafe database name: ${name}`);
}

function databaseUrl(name) {
  assertSafeDatabaseName(name);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.search = "";
  return url.toString();
}

function childEnvironment(overrides = {}) {
  return {
    ...process.env,
    ...overrides,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${blockerUrl}`].filter(Boolean).join(" "),
    AWS_REGION: "us-east-1",
    S3_BUCKET: "shotdeck-cutover-dry-run",
    AWS_ACCESS_KEY_ID: "local-dry-run",
    AWS_SECRET_ACCESS_KEY: "local-dry-run",
    AWS_SESSION_TOKEN: "",
    AWS_PROFILE: "",
    AWS_ENDPOINT_URL_S3: "http://127.0.0.1:1",
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "false",
    AWS_MAX_ATTEMPTS: "1",
    AWS_EC2_METADATA_DISABLED: "true",
    OPENAI_API_KEY: "",
  };
}

async function withAdmin(work) {
  const client = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(name) {
  assertSafeDatabaseName(name);
  await withAdmin(async (client) => {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    assert.equal(existing.rowCount, 0, `Throwaway database already exists: ${name}`);
    await client.query(`CREATE DATABASE ${name}`);
  });
  createdDatabases.add(name);
}

async function dropDatabase(name) {
  assertSafeDatabaseName(name);
  await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  createdDatabases.delete(name);
}

async function connectDatabase(name) {
  const client = new Client({ connectionString: databaseUrl(name), connectionTimeoutMillis: 5_000 });
  await client.connect();
  return client;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function runNode(args, databaseName, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: serverDir,
    env: childEnvironment({ DATABASE_URL: databaseUrl(databaseName) }),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

async function applyApprovedFixups(databaseName) {
  const client = await connectDatabase(databaseName);
  try {
    for (const [index, sceneId] of localSceneIds.entries()) {
      const startLine = index * 10;
      const endLine = startLine + 4;
      await client.query(
        `UPDATE script_scene_anchors
         SET anchor_geometry = jsonb_build_array(
               jsonb_build_object(
                 'kind', 'start', 'version', 2, 'unit', 'pt',
                 'page', $2::int, 'line', $3::int, 'top', $4::int, 'bottom', $5::int, 'text', selected_text
               ),
               jsonb_build_object(
                 'kind', 'end', 'version', 2, 'unit', 'pt',
                 'page', $2::int, 'line', $6::int, 'top', $7::int, 'bottom', $8::int, 'text', selected_text
               )
             ),
             formatted_selected_text = COALESCE(formatted_selected_text, selected_text)
         WHERE id = (SELECT anchor_id FROM script_scene_annotations WHERE id = $1)`,
        [sceneId, 90, startLine, 100 + startLine * 12, 112 + startLine * 12, endLine, 100 + endLine * 12, 112 + endLine * 12]
      );
    }
    await client.query("UPDATE script_scene_annotations SET tags = '[]'::jsonb WHERE id = ANY($1::uuid[])", [
      localSceneIds,
    ]);
    await client.query(
      `UPDATE script_scene_annotations
       SET start_time_seconds = source.end_time_seconds,
           end_time_seconds = source.end_time_seconds + 10
       FROM script_scene_annotations source
       WHERE script_scene_annotations.id = $1 AND source.id = $2`,
      [localSceneIds[2], localSceneIds[1]]
    );
  } finally {
    await client.end();
  }
}

async function catalog(databaseName) {
  const client = await connectDatabase(databaseName);
  try {
    const [columns, constraints, indexes] = await Promise.all([
      client.query(
        `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
                is_generated, generation_expression
         FROM information_schema.columns
         WHERE table_schema = 'public'
         ORDER BY table_name, column_name`
      ),
      client.query(
        `SELECT c.conname, c.contype, rel.relname AS table_name,
                pg_get_constraintdef(c.oid, true) AS definition
         FROM pg_constraint c
         JOIN pg_class rel ON rel.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = rel.relnamespace
         WHERE n.nspname = 'public'
         ORDER BY table_name, c.conname`
      ),
      client.query(
        `SELECT tablename, indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = 'public'
         ORDER BY tablename, indexname`
      ),
    ]);
    return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
  } finally {
    await client.end();
  }
}

async function reconcile(databaseName, report) {
  assert.equal(report.status, "converted");
  assert.deepEqual(report.scanned, { captured_scenes: 3, script_annotations: 3 });
  assert.deepEqual(report.converted, { captured_scenes: 3 });
  assert.deepEqual(report.dropped, {
    script_annotations: 3,
    stills_with_title_or_body: 2,
    movies_with_links: 1,
  });
  assert.deepEqual(report.aborts, []);

  const client = await connectDatabase(databaseName);
  try {
    const ids = await client.query("SELECT id FROM captured_scenes ORDER BY id");
    assert.deepEqual(ids.rows.map((row) => row.id), localSceneIds);
    const state = await client.query(
      `SELECT to_regclass('public.script_annotations') AS annotations,
              to_regclass('public.script_scene_annotations') AS scenes,
              to_regclass('public.script_scene_anchors') AS anchors`
    );
    assert.deepEqual(state.rows[0], { annotations: null, scenes: null, anchors: null });
    const migration = await client.query("SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(migration.rows, [{ version: 1 }]);
  } finally {
    await client.end();
  }
}

async function startSidePortHealthCheck(databaseName) {
  process.env.DATABASE_URL = databaseUrl(databaseName);
  Object.assign(process.env, childEnvironment());
  const [{ app }, { pool }] = await Promise.all([
    import(pathToFileURL(path.join(serverDir, "src/app.js"))),
    import(pathToFileURL(path.join(serverDir, "src/db.js"))),
  ]);
  appPool = pool;
  apiServer = await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
  const address = apiServer.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await new Promise((resolve, reject) => apiServer.close((error) => (error ? reject(error) : resolve())));
  apiServer = undefined;
  await appPool.end();
  appPool = undefined;
}

async function runBrowserSmoke() {
  const child = spawn("npm", ["run", "smoke:browser"], {
    cwd: root,
    env: childEnvironment({ SMOKE_DATABASE_ADMIN_URL: adminUrl.toString() }),
    stdio: "inherit",
  });
  activeChild = child;
  const result = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("exit", (status, signal) => resolve({ status, signal }));
  });
  activeChild = undefined;
  throwIfInterrupted();
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `Browser smoke ended from ${result.signal}`);
  assert.equal(result.status, 0, `Browser smoke exited with status ${result.status}`);
}

async function closeApi() {
  if (apiServer) {
    await new Promise((resolve) => apiServer.close(resolve));
    apiServer = undefined;
  }
  if (appPool) {
    await appPool.end();
    appPool = undefined;
  }
}

try {
  assert.ok(["postgres:", "postgresql:"].includes(adminUrl.protocol), "The admin URL must use Postgres.");
  assert.ok(loopbackHosts.has(adminUrl.hostname), "The admin URL must use a loopback hostname.");
  assert.equal(adminUrl.pathname, "/postgres", "The admin URL must name the postgres database.");
  assert.equal(adminUrl.search, "", "The admin URL must not have query parameters.");
  assert.equal(adminUrl.hash, "", "The admin URL must not have a fragment.");

  const dumpPath = process.env.LEGACY_DUMP_PATH;
  assert.ok(dumpPath, "Set LEGACY_DUMP_PATH to the approved G2 dump.");
  assert.equal(await realpath(dumpPath), approvedDump, "LEGACY_DUMP_PATH must resolve to the approved G2 dump.");
  assert.equal((await stat(dumpPath)).mode & 0o777, 0o600, "The approved dump must retain mode 0600.");
  assert.equal(await sha256(dumpPath), approvedDumpSha256, "The approved dump SHA-256 changed.");
  pass("the only accepted legacy input is the mode-0600 approved G2 dump with its recorded SHA-256");

  await withAdmin(async (client) => {
    const leftovers = await client.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'shotdeck\\_test\\_18\\_%' ESCAPE '\\' ORDER BY datname"
    );
    assert.deepEqual(leftovers.rows, [], "An earlier Issue 18 throwaway database still exists.");
  });

  await createDatabase(databaseNames.converted);
  const container = spawnSync("docker", ["inspect", "-f", "{{.State.Running}} {{.State.Health.Status}}", "shotdeck-db-1"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(container.status, 0, container.stderr || container.error?.message);
  assert.equal(container.stdout.trim(), "true healthy", "The existing shotdeck-db-1 container must be healthy.");
  const restore = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "shotdeck-db-1",
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "-U",
      decodeURIComponent(adminUrl.username),
      "-d",
      databaseNames.converted,
    ],
    {
      input: await readFile(dumpPath),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    }
  );
  assert.equal(restore.status, 0, restore.stderr || restore.error?.message);
  pass(`the approved dump restored only into ${databaseNames.converted}`);

  await applyApprovedFixups(databaseNames.converted);
  pass("all four Contract section 7.6 repairs were applied without embedding legacy scene text");

  const convertAndMigrate = runNode(
    [
      "--input-type=module",
      "-e",
      `import { spawnSync } from "node:child_process";
       const result = spawnSync("sh", ["-c", 'node src/tools/convert-captured-scenes.js > "$1" && node src/migrate.js', "cutover", process.argv[1]], { stdio: "inherit" });
       process.exit(result.status ?? 1);`,
      reportPath,
    ],
    databaseNames.converted
  );
  assert.equal(convertAndMigrate.status, 0, convertAndMigrate.stderr || convertAndMigrate.error?.message);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  await reconcile(databaseNames.converted, report);
  pass("the exact converter-then-migrate shell semantics committed and reconciled 3 canonical scenes");

  const secondConversion = runNode(["src/tools/convert-captured-scenes.js"], databaseNames.converted);
  assert.equal(secondConversion.status, 0, secondConversion.stderr || secondConversion.error?.message);
  assert.equal(JSON.parse(secondConversion.stdout).status, "already_converted");
  pass("a second conversion is an idempotent no-op");

  await createDatabase(databaseNames.fresh);
  const freshMigration = runNode(["src/migrate.js"], databaseNames.fresh);
  assert.equal(freshMigration.status, 0, freshMigration.stderr || freshMigration.error?.message);
  assert.deepEqual(await catalog(databaseNames.converted), await catalog(databaseNames.fresh));
  pass("the converted catalog matches a fresh canonical migration catalog");

  await startSidePortHealthCheck(databaseNames.converted);
  pass("the canonical API answered /health on a loopback side port");

  await dropDatabase(databaseNames.fresh);
  await dropDatabase(databaseNames.converted);
  pass("the Issue 18 throwaway databases were removed before the independent browser smoke");

  console.log("RUN npm run smoke:browser");
  await runBrowserSmoke();
  pass("Issue 16's exact browser smoke command passed unchanged");

  await withAdmin(async (client) => {
    const leftovers = await client.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'shotdeck\\_test\\_%' ESCAPE '\\' ORDER BY datname"
    );
    assert.deepEqual(leftovers.rows, []);
  });
  pass("no shotdeck_test_* database remains");
} catch (error) {
  if (error instanceof DryRunInterrupted) {
    console.error(error.message);
  } else {
    throw error;
  }
} finally {
  await closeApi().catch((error) => console.error(`API cleanup failed: ${error.message}`));
  for (const name of [...createdDatabases].toReversed()) {
    await dropDatabase(name).catch((error) => console.error(`Database cleanup failed for ${name}: ${error.message}`));
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
