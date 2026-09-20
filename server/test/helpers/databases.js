import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createTestDatabases, postgresAdmin } from "./database-lifetime.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEGACY_SCHEMA_PATH = path.join(serverDir, "test/fixtures/legacy-schema.sql");
const baseUrl = new URL(process.env.DATABASE_URL);
const baseName = baseUrl.pathname.slice(1);
const databases = createTestDatabases(postgresAdmin(baseUrl));

function databaseName(suffix) {
    if (!/^[a-z0-9_]{1,30}$/.test(suffix)) throw new Error(`Invalid test database suffix: ${suffix}`);
    const name = `${baseName}_${suffix}`;
    if (!name.startsWith("shotdeck_test_")) throw new Error(`Refusing non-test database name: ${name}`);
    return name;
}

function databaseUrl(suffix) {
    const url = new URL(baseUrl);
    url.pathname = `/${databaseName(suffix)}`;
    url.search = "";
    return url.toString();
}

export async function createTestDatabase(suffix) {
    await databases.create(databaseName(suffix));
    return databaseUrl(suffix);
}

export const cleanupTestDatabases = databases.cleanup;

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
