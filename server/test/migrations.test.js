import "./helpers/guard.js";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    applyLegacySchema,
    connectDatabase,
    createTestDatabase,
    dropTestDatabase,
    runServerNode,
} from "./helpers/databases.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUFFIXES = ["migrate_fresh", "migrate_legacy", "migrate_order"];

before(async () => {
    for (const suffix of SUFFIXES) await createTestDatabase(suffix);
});

after(async () => {
    for (const suffix of SUFFIXES.toReversed()) await dropTestDatabase(suffix);
});

describe("the numbered migration runner", () => {
    test("builds only the canonical schema, records version 1 and is idempotent", async () => {
        const first = runServerNode("src/migrate.js", "migrate_fresh");
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stdout, /Applied migrations: 0001_canonical_schema/);

        const db = await connectDatabase("migrate_fresh");
        try {
            const tables = await db.query(
                `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
            );
            assert.deepEqual(
                tables.rows.map((row) => row.tablename),
                ["admin_sessions", "admin_users", "annotations", "captured_scenes", "movies", "schema_migrations", "scripts"]
            );
            const ledger = await db.query("SELECT version, name FROM schema_migrations");
            assert.deepEqual(ledger.rows, [{ version: 1, name: "0001_canonical_schema" }]);
            const constraints = await db.query(
                `SELECT conname FROM pg_constraint
                 WHERE conrelid = 'captured_scenes'::regclass
                 ORDER BY conname`
            );
            assert.ok(constraints.rows.some((row) => row.conname === "captured_scenes_no_film_timing_overlap"));
            assert.ok(constraints.rows.some((row) => row.conname === "captured_scenes_no_script_location_overlap"));
        } finally {
            await db.end();
        }

        const second = runServerNode("src/migrate.js", "migrate_fresh");
        assert.equal(second.status, 0, second.stderr);
        assert.match(second.stdout, /No migrations pending/);
    });

    test("refuses an incompatible database before creating the ledger", async () => {
        const db = await connectDatabase("migrate_legacy");
        try {
            await applyLegacySchema(db);
        } finally {
            await db.end();
        }
        const run = runServerNode("src/migrate.js", "migrate_legacy");
        assert.notEqual(run.status, 0);
        assert.match(run.stderr, /predates the supported schema/);
        const check = await connectDatabase("migrate_legacy");
        try {
            const result = await check.query("SELECT to_regclass('public.schema_migrations') AS ledger");
            assert.equal(result.rows[0].ledger, null);
        } finally {
            await check.end();
        }
    });

    test("refuses a pending migration below the highest applied version", async () => {
        const db = await connectDatabase("migrate_order");
        try {
            await db.query(`
              CREATE TABLE schema_migrations (
                version INT PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
              );
              INSERT INTO schema_migrations (version, name) VALUES (2, '0002_future');
            `);
        } finally {
            await db.end();
        }
        const run = runServerNode("src/migrate.js", "migrate_order");
        assert.notEqual(run.status, 0);
        assert.match(run.stderr, /0001_canonical_schema\.sql is pending below already-applied version 2/);
    });
});

async function javascriptFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) return javascriptFiles(target);
            return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
        })
    );
    return nested.flat();
}

test("server source never imports from the client tree", async () => {
    for (const file of await javascriptFiles(path.join(serverDir, "src"))) {
        const source = await readFile(file, "utf8");
        assert.doesNotMatch(source, /(?:from\s+|import\s*\()["'][^"']*client\//, path.relative(serverDir, file));
    }
});
