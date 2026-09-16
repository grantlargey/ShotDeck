import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEGACY_SCHEMA_PATH = path.join(serverDir, "test/fixtures/legacy-schema.sql");
const baseUrl = new URL(process.env.DATABASE_URL);
const baseName = baseUrl.pathname.slice(1);

function databaseName(suffix) {
    if (!/^[a-z0-9_]{1,30}$/.test(suffix)) throw new Error(`Invalid test database suffix: ${suffix}`);
    const name = `${baseName}_${suffix}`;
    if (!name.startsWith("shotdeck_test_")) throw new Error(`Refusing non-test database name: ${name}`);
    return name;
}

export function databaseUrl(suffix) {
    const url = new URL(baseUrl);
    url.pathname = `/${databaseName(suffix)}`;
    url.search = "";
    return url.toString();
}

async function withAdmin(work) {
    const url = new URL(baseUrl);
    url.pathname = "/postgres";
    url.search = "";
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
        return await work(client);
    } finally {
        await client.end();
    }
}

export async function createTestDatabase(suffix) {
    const name = databaseName(suffix);
    await withAdmin(async (client) => {
        const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
        if (existing.rowCount > 0) throw new Error(`Test database already exists: ${name}`);
        await client.query(`CREATE DATABASE ${name}`);
    });
    return databaseUrl(suffix);
}

export async function dropTestDatabase(suffix) {
    const name = databaseName(suffix);
    await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
}

export async function connectDatabase(suffix) {
    const client = new pg.Client({ connectionString: databaseUrl(suffix) });
    await client.connect();
    return client;
}

export async function applyLegacySchema(client) {
    await client.query(await readFile(LEGACY_SCHEMA_PATH, "utf8"));
}

export function runServerNode(script, suffix, args = []) {
    return spawnSync(process.execPath, [script, ...args], {
        cwd: serverDir,
        env: { ...process.env, DATABASE_URL: databaseUrl(suffix) },
        encoding: "utf8",
        timeout: 120_000,
    });
}

export async function restoreDump(suffix, dumpPath) {
    const dump = await readFile(dumpPath);
    const restored = spawnSync(
        "docker",
        ["exec", "-i", "shotdeck-db-1", "pg_restore", "-U", "app", "-d", databaseName(suffix), "--no-owner", "--no-privileges"],
        { input: dump, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 120_000 }
    );
    if (restored.status !== 0) throw new Error(`Could not restore legacy dump: ${restored.stderr}`);
}
