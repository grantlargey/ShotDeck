/*
 * `npm test` for the server. Runs the test files against a throwaway Postgres
 * database, then always drops it.
 *
 *   TEST_DB_SUFFIX=01 npm test --prefix server              every test file
 *   DATABASE_URL=postgres://.../scriptdeck_test_ci npm test --prefix server
 *   npm test --prefix server -- test/auth.test.js          only these files (relative to server/)
 *   npm test --prefix server -- --test-name-pattern=login  node --test flags, written --flag=value
 *
 * The database is `scriptdeck_test_<TEST_DB_SUFFIX>`; give runs that happen at
 * the same time different suffixes. Without one, the suffix is this process's
 * id. With DATABASE_URL, the named scriptdeck_test_* database must already
 * exist and is left for the provider to clean up (for example a CI Postgres
 * service). Otherwise a run refuses to start when its database already exists,
 * so it never drops a database it didn't create.
 *
 * Postgres is reached over TCP, so it works the same whether it runs in this
 * repository's Compose stack, another container, or directly on the machine.
 * TEST_DATABASE_ADMIN_URL overrides the default local connection. This command
 * never starts Postgres.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createTestDatabases, postgresAdmin } from "./helpers/database-lifetime.js";

const DEFAULT_ADMIN_URL = "postgres://app:app@127.0.0.1:5432/postgres";
const DEFAULT_TEST_FILES = ["test/**/*.test.js"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
    console.error(`\n${message}\n`);
    process.exit(1);
}

/** The administrative connection used to create and drop the throwaway database. */
function adminUrl() {
    const value = process.env.TEST_DATABASE_ADMIN_URL?.trim() || DEFAULT_ADMIN_URL;
    let url;
    try {
        url = new URL(value);
    } catch {
        return fail("TEST_DATABASE_ADMIN_URL must be a valid Postgres URL.");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        fail("TEST_DATABASE_ADMIN_URL must use the postgres protocol.");
    }
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
        fail("TEST_DATABASE_ADMIN_URL must use a loopback hostname.");
    }
    if (url.pathname !== "/postgres") {
        fail("TEST_DATABASE_ADMIN_URL must name the postgres administrative database.");
    }
    return url;
}

function databaseName() {
    const suffix = process.env.TEST_DB_SUFFIX || `pid${process.pid}`;
    if (!/^[a-z0-9_]{1,40}$/.test(suffix)) {
        fail(`TEST_DB_SUFFIX must be 1-40 lowercase letters, digits or underscores; got "${suffix}".`);
    }
    return `scriptdeck_test_${suffix}`;
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
    if (!name.startsWith("scriptdeck_test_")) {
        fail(`Refusing DATABASE_URL for non-test database "${name}"; its name must start with scriptdeck_test_.`);
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

/** Fails with a readable message when nothing answers on the administrative connection. */
async function checkPostgres(url) {
    const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5_000 });
    try {
        await client.connect();
        await client.query("SELECT 1");
    } catch (error) {
        fail(
            `Postgres isn't reachable at ${url.host}, so the server tests can't create their database.\n` +
                `${error.message}\n\n` +
                "Start it with `npm run db:up` from the repository root, then run the tests again. " +
                "This command never starts it."
        );
    } finally {
        await client.end().catch(() => {});
    }
}

function testDatabaseUrl(url, name) {
    const databaseUrl = new URL(url);
    databaseUrl.pathname = `/${name}`;
    databaseUrl.search = "";
    return databaseUrl.toString();
}

function dropCommand(url, name) {
    return `psql "${testDatabaseUrl(url, "postgres")}" -c 'DROP DATABASE IF EXISTS ${name} WITH (FORCE)'`;
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
        S3_BUCKET: "scriptdeck-test-bucket",
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
const administrative = adminUrl();
const databases = createTestDatabases(postgresAdmin(administrative));
const database = suppliedUrl ? null : databaseName();
const args = testArgs(process.argv.slice(2));
if (!suppliedUrl) {
    await checkPostgres(administrative);
}

let exitCode = 1;
try {
    if (database) await databases.create(database);
    const env = testEnvironment(suppliedUrl ?? testDatabaseUrl(administrative, database));
    if (!interrupted) exitCode = await runNode(["src/migrate.js"], env);
    if (exitCode !== 0) {
        console.error(`\nApplying the schema to ${database} failed.`);
    } else if (!interrupted) {
        exitCode = await runNode(args, env);
    }
} catch (error) {
    console.error(error);
    if (database) {
        console.error(
            `If no run is using it, remove a leftover database with:\n  ${dropCommand(administrative, database)}`
        );
    }
    exitCode = 1;
} finally {
    try {
        await databases.cleanup();
    } catch (error) {
        console.error(error);
        if (database) {
            console.error(`Remove the leftover database with:\n  ${dropCommand(administrative, database)}`);
        }
        exitCode = exitCode || 1;
    }
}
process.exit(interrupted && exitCode === 0 ? 1 : exitCode);
