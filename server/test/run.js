/*
 * `npm test` for the server. Runs the test files against a throwaway Postgres
 * database in the local `shotdeck-db-1` container, then always drops it.
 *
 *   TEST_DB_SUFFIX=01 npm test --prefix server              every test file
 *   npm test --prefix server -- test/auth.test.js          only these files (relative to server/)
 *   npm test --prefix server -- --test-name-pattern=login  node --test flags pass through
 *
 * The database is `shotdeck_test_<TEST_DB_SUFFIX>`; give runs that happen at the
 * same time different suffixes. Without one, the suffix is this process's id.
 * A run refuses to start when its database already exists, so it never drops a
 * database it didn't create. It never starts the container either.
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

function createDatabase(name) {
    const existing = psql(`SELECT 1 FROM pg_database WHERE datname = '${name}'`);
    if (existing.status !== 0) fail(`Couldn't check for ${name}:\n${existing.stderr}`);
    if (existing.stdout.trim() === "1") {
        fail(
            `The database ${name} already exists. Another run with the same TEST_DB_SUFFIX may be in progress, ` +
                "or an earlier run was killed before it could clean up.\n" +
                `If no run is in progress, drop it with:\n  docker exec ${CONTAINER} psql -U app -d postgres -c 'DROP DATABASE ${name}'`
        );
    }
    const created = psql(`CREATE DATABASE ${name}`);
    if (created.status !== 0) fail(`Couldn't create ${name}:\n${created.stderr}`);
}

function dropDatabase(name) {
    // FORCE ends connections a crashed test process may have left open.
    const dropped = psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    if (dropped.status !== 0) {
        console.error(`\nCouldn't drop ${name}. Drop it by hand:\n${dropped.stderr}`);
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
        AWS_MAX_ATTEMPTS: "1",
        AWS_EC2_METADATA_DISABLED: "true",
        // Empty counts as unset for the formatter, which then answers 503.
        OPENAI_API_KEY: "",
        ALLOWED_ORIGINS: "",
    };
}

let child = null;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
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

function testArgs(extraArgs) {
    const flags = extraArgs.filter((arg) => arg.startsWith("-"));
    const files = extraArgs.filter((arg) => !arg.startsWith("-"));
    // One file at a time: the files share the database.
    return ["--test", "--test-concurrency=1", ...flags, ...(files.length > 0 ? files : DEFAULT_TEST_FILES)];
}

const database = databaseName();
checkContainer();
createDatabase(database);

let exitCode = 1;
try {
    const env = testEnvironment(`postgres://app:app@127.0.0.1:5432/${database}`);
    exitCode = await runNode(["src/migrate.js"], env);
    if (exitCode !== 0) {
        console.error(`\nApplying the schema to ${database} failed.`);
    } else if (!interrupted) {
        exitCode = await runNode(testArgs(process.argv.slice(2)), env);
    }
} finally {
    if (!dropDatabase(database)) exitCode = exitCode || 1;
}
process.exit(interrupted && exitCode === 0 ? 1 : exitCode);
