import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(__dirname, "../sql/migrations");
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

async function readMigrations() {
    const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
    const migrations = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => {
            const match = entry.name.match(MIGRATION_FILE);
            if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
            return { version: Number(match[1]), name: entry.name.slice(0, -4), file: entry.name };
        })
        .sort((a, b) => a.version - b.version);

    const versions = new Set();
    for (const migration of migrations) {
        if (versions.has(migration.version)) throw new Error(`Duplicate migration version: ${migration.version}`);
        versions.add(migration.version);
    }
    return migrations;
}

async function applyMigration(db, migration) {
    const sql = await fs.readFile(path.join(migrationsDirectory, migration.file), "utf8");
    await db.query("BEGIN");
    try {
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [
            migration.version,
            migration.name,
        ]);
        await db.query("COMMIT");
    } catch (error) {
        await db.query("ROLLBACK").catch(() => {});
        throw error;
    }
}

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock(hashtextextended('scriptdeck-schema-migrations', 0))");

        await client.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        const [migrations, appliedResult] = await Promise.all([
            readMigrations(),
            client.query("SELECT version, name FROM schema_migrations ORDER BY version"),
        ]);
        const applied = new Set(appliedResult.rows.map((row) => row.version));
        const highestApplied = Math.max(0, ...applied);
        const pending = migrations.filter((migration) => !applied.has(migration.version));
        const outOfOrder = pending.find((migration) => migration.version < highestApplied);
        if (outOfOrder) {
            throw new Error(
                `Migration ${outOfOrder.file} is pending below already-applied version ${highestApplied}; renumber it.`
            );
        }

        for (const migration of pending) await applyMigration(client, migration);
        if (pending.length === 0) console.log("No migrations pending.");
        else console.log(`Applied migrations: ${pending.map((migration) => migration.name).join(", ")}`);
    } finally {
        client.release();
        await pool.end();
    }
}

await runMigrations();
