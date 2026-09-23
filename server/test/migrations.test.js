import "./helpers/guard.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    applyLegacySchema,
    applyV1Schema,
    connectDatabase,
    createTestDatabase,
    cleanupTestDatabases,
    runServerNode,
} from "./helpers/databases.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUFFIXES = ["migrate_fresh", "migrate_legacy", "migrate_order", "migrate_upgrade", "migrate_duplicates", "migrate_scripts"];

before(async () => {
    for (const suffix of SUFFIXES) await createTestDatabase(suffix);
});

after(cleanupTestDatabases);

describe("the numbered migration runner", () => {
    test("builds only the canonical schema, records both versions and is idempotent", async () => {
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
            assert.deepEqual(ledger.rows, [
                { version: 1, name: "0001_canonical_schema" },
                { version: 2, name: "0002_shot_timing_and_script_pages" },
            ]);
            const columns = await db.query(
                `SELECT table_name, column_name, is_nullable, column_default
                 FROM information_schema.columns
                 WHERE table_name IN ('annotations', 'scripts')`
            );
            const column = (table, name) => columns.rows.find((row) => row.table_name === table && row.column_name === name);
            assert.equal(column("annotations", "created_at"), undefined);
            assert.equal(column("scripts", "created_at"), undefined);
            // Every script states its length, and nothing supplies a default for it.
            assert.deepEqual(column("scripts", "page_count"), {
                table_name: "scripts",
                column_name: "page_count",
                is_nullable: "NO",
                column_default: null,
            });
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
            assert.equal(
                (await db.query("SELECT to_regclass('public.idx_scripts_movie_id_unique') AS index")).rows[0].index,
                null
            );
            // Page counts and scene anchors share one screenplay-length ceiling.
            for (const name of ["scripts_page_count_check", "captured_scenes_start_page_check", "captured_scenes_end_page_check"]) {
                assert.match(named(name).def, /<= 300\)/, name);
            }
        } finally {
            await db.end();
        }

        const second = runServerNode("src/migrate.js", "migrate_fresh");
        assert.equal(second.status, 0, second.stderr);
        assert.match(second.stdout, /No migrations pending/);
    });

    for (const duplicates of [false, true]) {
        test(duplicates ? "duplicate timestamps abort migration without dropping shot data" : "upgrades existing annotations without losing shots", async () => {
            const suffix = duplicates ? "migrate_duplicates" : "migrate_upgrade";
            const db = await connectDatabase(suffix);
            const movieId = randomUUID();
            const firstId = randomUUID();
            try {
                await applyV1Schema(db);
                await db.query("INSERT INTO movies (id, title, director, year, runtime_minutes) VALUES ($1, 'Film', 'Director', 2024, 90)", [movieId]);
                await db.query("INSERT INTO annotations (id, movie_id, time_seconds, image_key, thumb_key) VALUES ($1, $2, 5425, 'frame.jpg', 'thumb.webp')", [firstId, movieId]);
                if (duplicates) {
                    await db.query("INSERT INTO annotations (id, movie_id, time_seconds) VALUES ($1, $2, 5425)", [randomUUID(), movieId]);
                }
                const run = runServerNode("src/migrate.js", suffix);
                const rows = await db.query("SELECT * FROM annotations ORDER BY id");
                if (duplicates) {
                    assert.notEqual(run.status, 0);
                    assert.match(run.stderr, /annotations_movie_time_unique/);
                    assert.equal(rows.rows.length, 2);
                    assert.ok(rows.rows.every((row) => row.created_at));
                    assert.equal((await db.query("SELECT * FROM schema_migrations WHERE version = 2")).rowCount, 0);
                } else {
                    assert.equal(run.status, 0, run.stderr);
                    assert.deepEqual(rows.rows, [{ id: firstId, movie_id: movieId, time_seconds: 5425, image_key: "frame.jpg", thumb_key: "thumb.webp" }]);
                    await assert.rejects(
                        db.query("INSERT INTO annotations (id, movie_id, time_seconds) VALUES ($1, $2, 5425)", [randomUUID(), movieId]),
                        { code: "23505", constraint: "annotations_movie_time_unique" }
                    );
                }
            } finally {
                await db.end();
            }
        });
    }

    test("gives scripts saved before page counts a placeholder, and holds later ones to the page bounds", async () => {
        const db = await connectDatabase("migrate_scripts");
        const movieId = randomUUID();
        const scriptId = randomUUID();
        try {
            await applyV1Schema(db);
            await db.query("INSERT INTO movies (id, title, director, year, runtime_minutes) VALUES ($1, 'Film', 'Director', 2024, 90)", [movieId]);
            await db.query("INSERT INTO scripts (id, movie_id, s3_key) VALUES ($1, $2, 'scripts/film/draft.pdf')", [scriptId, movieId]);

            const run = runServerNode("src/migrate.js", "migrate_scripts");
            assert.equal(run.status, 0, run.stderr);
            assert.deepEqual((await db.query("SELECT * FROM scripts")).rows, [
                { id: scriptId, movie_id: movieId, s3_key: "scripts/film/draft.pdf", page_count: 1 },
            ]);

            // A second film, so these inserts can only fail on the page count.
            const otherId = randomUUID();
            await db.query("INSERT INTO movies (id, title, director, year, runtime_minutes) VALUES ($1, 'Other', 'Director', 2024, 90)", [otherId]);
            await assert.rejects(
                db.query("INSERT INTO scripts (id, movie_id, s3_key) VALUES ($1, $2, 'scripts/other/v2.pdf')", [randomUUID(), otherId]),
                { code: "23502", column: "page_count" }
            );
            for (const pages of [0, 301]) {
                await assert.rejects(
                    db.query(
                        "INSERT INTO scripts (id, movie_id, s3_key, page_count) VALUES ($1, $2, 'scripts/other/v2.pdf', $3)",
                        [randomUUID(), otherId, pages]
                    ),
                    { code: "23514" }
                );
            }
        } finally {
            await db.end();
        }
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
