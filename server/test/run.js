/*
 * `npm test` for the server. Runs the test files against a throwaway Postgres
 * database in the local `shotdeck-db-1` container, then always drops it.
 *
 *   TEST_DB_SUFFIX=01 npm test --prefix server              every test file
 *   DATABASE_URL=postgres://.../shotdeck_test_ci npm test --prefix server
 *   npm test --prefix server -- test/auth.test.js          only these files (relative to server/)
 *   npm test --prefix server -- --test-name-pattern=login  node --test flags, written --flag=value
 *
 * The database is `shotdeck_test_<TEST_DB_SUFFIX>`; give runs that happen at the
 * same time different suffixes. Without one, the suffix is this process's id.
 * With DATABASE_URL, the named shotdeck_test_* database must already exist and
 * is left for the provider to clean up (for example a CI Postgres service). In
 * local-container mode, a run refuses to start when its database already exists,
 * so it never drops a database it didn't create. It never starts the container.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTAINER = "shotdeck-db-1";
const DEFAULT_TEST_FILES = ["test/**/*.test.js"];
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
    console.error(`\n${message}\n`);
    process.exit(1);
}

function psql(sql) {
    return spawnSync(
        "docker",
        ["exec", CONTAINER, "psql", "-U", "app", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atqc", sql],
        { encoding: "utf8", timeout: 30_000 }
    );
}

function databaseName() {
    const suffix = process.env.TEST_DB_SUFFIX || `pid${process.pid}`;
    if (!/^[a-z0-9_]{1,40}$/.test(suffix)) {
        fail(`TEST_DB_SUFFIX must be 1-40 lowercase letters, digits or underscores; got "${suffix}".`);
    }
    return `shotdeck_test_${suffix}`;
}

function providedDatabaseUrl() {
    const value = process.env.DATABASE_URL?.trim();
    if (!value) return null;

    let url;
    try {
        url = new URL(value);
    } catch {
        fail("DATABASE_URL must be a valid Postgres URL.");
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!name.startsWith("shotdeck_test_")) {
        fail(`Refusing DATABASE_URL for non-test database "${name}"; its name must start with shotdeck_test_.`);
    }
    return value;
}

// Each test file must run alone in its own process: the files share the database,
// and each file closes its database pool and keeps its own sign-in rate limiter.
const FIXED_FLAGS = ["--test-concurrency", "--test-isolation", "--experimental-test-isolation"];

/**
 * The `node --test` arguments. Extra arguments are test files or globs ending in
 * `.js` (relative to server/), or node --test flags written `--flag=value`. Flags
 * that change concurrency or isolation are refused.
 */
function testArgs(extraArgs) {
    const flags = [];
    const files = [];
    for (const arg of extraArgs) {
        const fixed = FIXED_FLAGS.find((flag) => arg === flag || arg.startsWith(`${flag}=`));
        if (fixed) {
            fail(`${fixed} can't be changed: each test file runs alone, in its own process.`);
        } else if (arg.startsWith("-")) {
            flags.push(arg);
        } else if (arg.endsWith(".js")) {
            files.push(arg);
        } else {
            fail(
                `"${arg}" isn't a test file (a path or glob ending in .js). ` +
                    "Give node --test flags their value with =, for example --test-name-pattern=login."
            );
        }
    }
    return ["--test", ...flags, "--test-concurrency=1", ...(files.length > 0 ? files : DEFAULT_TEST_FILES)];
}

function checkContainer() {
    const inspect = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], {
        encoding: "utf8",
        timeout: 30_000,
    });
    if (inspect.error || inspect.status !== 0 || inspect.stdout.trim() !== "true") {
        fail(
            `The Postgres container ${CONTAINER} isn't running, so the server tests can't create their database.\n` +
                "Start it with `npm run db:up` from the main checkout, then run the tests again. This command never starts it."
        );
    }
    const ping = psql("SELECT 1");
    if (ping.status !== 0) fail(`Postgres in ${CONTAINER} isn't accepting connections yet:\n${ping.stderr}`);
}

function dropCommand(name) {
    return `docker exec ${CONTAINER} psql -U app -d postgres -c 'DROP DATABASE IF EXISTS ${name} WITH (FORCE)'`;
}

function createDatabase(name) {
    const existing = psql(`SELECT 1 FROM pg_database WHERE datname = '${name}'`);
    if (existing.status !== 0) fail(`Couldn't check for ${name}:\n${existing.stderr}`);
    if (existing.stdout.trim() === "1") {
        fail(
            `The database ${name} already exists. Another run with the same TEST_DB_SUFFIX may be in progress, ` +
                "or an earlier run was killed before it could clean up.\n" +
                `If no run is in progress, drop it with:\n  ${dropCommand(name)}`
        );
    }
    const created = psql(`CREATE DATABASE ${name}`);
    if (created.status !== 0) fail(`Couldn't create ${name}:\n${created.stderr}`);
}

function dropDatabase(name) {
    // FORCE ends connections a crashed test process may have left open.
    const dropped = psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    if (dropped.status !== 0) {
        console.error(`\nCouldn't drop ${name}:\n${dropped.stderr || dropped.error || ""}\nDrop it by hand with:\n  ${dropCommand(name)}`);
        return false;
    }
    return true;
}

/**
 * The child processes' environment. Values are set explicitly, even when empty,
 * because dotenv never overrides a variable that already exists: a `server/.env`
 * next to the tests (as in the main checkout) must not supply a database, AWS
 * credentials, an OpenAI key or extra CORS origins.
 */
function testEnvironment(databaseUrl) {
    return {
        ...process.env,
        DATABASE_URL: databaseUrl,
        // Presigning is local. Anything that really sends to S3 goes to a closed
        // local port and fails on its first attempt.
        AWS_REGION: "us-east-1",
        S3_BUCKET: "shotdeck-test-bucket",
        AWS_ACCESS_KEY_ID: "test-access-key-id",
        AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
        AWS_SESSION_TOKEN: "",
        AWS_PROFILE: "",
        AWS_ENDPOINT_URL_S3: "http://127.0.0.1:9",
        // "true" here would make the SDK skip the endpoint above.
        AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "false",
        AWS_MAX_ATTEMPTS: "1",
        AWS_EC2_METADATA_DISABLED: "true",
        // Empty counts as unset for the formatter, which then answers 503.
        OPENAI_API_KEY: "",
        ALLOWED_ORIGINS: "",
    };
}

let child = null;
let interrupted = false;
// SIGHUP arrives when the terminal closes; the database is dropped then too.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
        interrupted = true;
        child?.kill(signal);
    });
}

function runNode(args, env) {
    return new Promise((resolve) => {
        child = spawn(process.execPath, args, { cwd: serverDir, env, stdio: "inherit" });
        child.on("error", (err) => {
            console.error(err);
            resolve(1);
        });
        child.on("exit", (code) => {
            child = null;
            resolve(code ?? 1);
        });
    });
}

const suppliedUrl = providedDatabaseUrl();
const database = suppliedUrl ? null : databaseName();
const args = testArgs(process.argv.slice(2));
if (!suppliedUrl) {
    checkContainer();
    createDatabase(database);
}

let exitCode = 1;
try {
    const env = testEnvironment(suppliedUrl ?? `postgres://app:app@127.0.0.1:5432/${database}`);
    exitCode = await runNode(["src/migrate.js"], env);
    if (exitCode !== 0) {
        console.error(`\nApplying the schema to ${database} failed.`);
    } else if (!interrupted) {
        exitCode = await runNode(args, env);
    }
} finally {
    if (database && !dropDatabase(database)) exitCode = exitCode || 1;
}
process.exit(interrupted && exitCode === 0 ? 1 : exitCode);
