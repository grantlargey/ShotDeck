import "./helpers/guard.js";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    connectDatabase,
    createTestDatabase,
    cleanupTestDatabases,
    runServerNode,
} from "./helpers/databases.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUFFIXES = ["migrate_fresh", "migrate_order"];

before(async () => {
    for (const suffix of SUFFIXES) await createTestDatabase(suffix);
});

after(cleanupTestDatabases);

describe("the numbered migration runner", () => {
    test("builds the canonical schema, records it and is idempotent", async () => {
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
            const ledger = await db.query("SELECT version, name FROM schema_migrations ORDER BY version");
            assert.deepEqual(ledger.rows, [{ version: 1, name: "0001_canonical_schema" }]);
            const columns = await db.query(
                `SELECT table_name, column_name, is_nullable, column_default
                 FROM information_schema.columns
                 WHERE table_name IN ('annotations', 'scripts')`
            );
            const column = (table, name) => columns.rows.find((row) => row.table_name === table && row.column_name === name);
            assert.equal(column("annotations", "created_at"), undefined);
            // A shot's moment carries a tenth of a second, so two shots caught
            // in one second keep their order without leaving it.
            const moment = await db.query(
                `SELECT data_type, numeric_scale FROM information_schema.columns
                 WHERE table_name = 'annotations' AND column_name = 'time_seconds'`
            );
            assert.deepEqual(moment.rows, [{ data_type: "numeric", numeric_scale: 1 }]);
            assert.equal(column("scripts", "created_at"), undefined);
            // A script row identifies its file and nothing else. The viewer
            // takes a screenplay's length from the PDF it has already loaded.
            assert.equal(column("scripts", "page_count"), undefined);
            // A captured scene keeps only what can't be recomputed from the PDF.
            const sceneColumns = await db.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_name = 'captured_scenes' ORDER BY column_name`
            );
            assert.deepEqual(
                sceneColumns.rows.map((row) => row.column_name),
                [
                    "end_page",
                    "end_time_seconds",
                    "end_y",
                    "id",
                    "scene_text",
                    "script_id",
                    "start_page",
                    "start_time_seconds",
                    "start_y",
                    "tags",
                ]
            );
            const constraints = await db.query(
                `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
                 FROM pg_constraint
                 WHERE conrelid IN ('captured_scenes'::regclass, 'scripts'::regclass)
                 ORDER BY conname`
            );
            const named = (name) => constraints.rows.find((row) => row.conname === name);
            assert.ok(named("captured_scenes_no_film_timing_overlap"));
            assert.ok(named("captured_scenes_no_script_location_overlap"));
            // One script per film, as a constraint rather than a bare index.
            assert.equal(named("scripts_movie_id_key").def, "UNIQUE (movie_id)");
            // Film timings are inclusive, so two scenes can't share a second.
            assert.match(
                named("captured_scenes_no_film_timing_overlap").def,
                /int8range\(\(start_time_seconds\)::bigint, \(end_time_seconds\)::bigint, '\[\]'::text\)/
            );
            // The document position is computed in the index, not stored on the row.
            assert.match(
                named("captured_scenes_no_script_location_overlap").def,
                /numrange\(\(\(\(start_page\)::numeric \* \(1000\)::numeric\) \+ start_y\)/
            );
            // Scene anchors are held to a screenplay's length.
            for (const name of ["captured_scenes_start_page_check", "captured_scenes_end_page_check"]) {
                assert.match(named(name).def, /<= 300\)/, name);
            }
        } finally {
            await db.end();
        }

        const second = runServerNode("src/migrate.js", "migrate_fresh");
        assert.equal(second.status, 0, second.stderr);
        assert.match(second.stdout, /No migrations pending/);
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
