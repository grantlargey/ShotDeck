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
const SUFFIXES = ["migrate_fresh", "migrate_legacy", "migrate_order", "migrate_upgrade", "migrate_duplicates", "migrate_scripts", "migrate_scenes", "migrate_touching"];

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
                { version: 2, name: "0002_shot_timing_and_scene_storage" },
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
            assert.equal(
                (await db.query("SELECT to_regclass('public.idx_scripts_movie_id_unique') AS index")).rows[0].index,
                null
            );
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

    test("carries stored scene anchors over as the baselines inside their line boxes", async () => {
        const db = await connectDatabase("migrate_scenes");
        const sceneId = randomUUID();
        try {
            const { scriptId } = await seedV1Script(db);
            // A 12pt line on a 12pt leading: ascent 0.82 and descent 0.24 of the
            // font size put the baseline at 96 inside a box of 86.16 to 98.88.
            await insertV1Scene(db, { id: sceneId, scriptId, timing: [10, 20], start: [86.16, 98.88], end: [122.16, 134.88] });

            const run = runServerNode("src/migrate.js", "migrate_scenes");
            assert.equal(run.status, 0, run.stderr);
            const rows = await db.query("SELECT start_page, start_y::float8 AS start_y, end_page, end_y::float8 AS end_y FROM captured_scenes");
            assert.deepEqual(rows.rows, [{ start_page: 2, start_y: 96, end_page: 2, end_y: 132 }]);

            // The carried-over anchors still order and exclude correctly.
            await assert.rejects(
                insertV2Scene(db, { scriptId, timing: [30, 40], start: [2, 132], end: [2, 156] }),
                { code: "23P01" }
            );
            await insertV2Scene(db, { scriptId, timing: [30, 40], start: [2, 144], end: [2, 156] });
        } finally {
            await db.end();
        }
    });

    test("scenes that share a second of film abort the migration without dropping them", async () => {
        const db = await connectDatabase("migrate_touching");
        try {
            const { scriptId } = await seedV1Script(db);
            await insertV1Scene(db, { id: randomUUID(), scriptId, timing: [10, 20], start: [86.16, 98.88], end: [122.16, 134.88] });
            await insertV1Scene(db, { id: randomUUID(), scriptId, timing: [20, 30], start: [158.16, 170.88], end: [194.16, 206.88] });

            const run = runServerNode("src/migrate.js", "migrate_touching");
            assert.notEqual(run.status, 0);
            assert.match(run.stderr, /captured_scenes_no_film_timing_overlap/);
            assert.equal((await db.query("SELECT * FROM captured_scenes")).rowCount, 2);
            assert.equal((await db.query("SELECT * FROM schema_migrations WHERE version = 2")).rowCount, 0);
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

/** A version-1 movie and script, ready for version-1 captured scenes. */
async function seedV1Script(db) {
    const movieId = randomUUID();
    const scriptId = randomUUID();
    await applyV1Schema(db);
    await db.query("INSERT INTO movies (id, title, director, year, runtime_minutes) VALUES ($1, 'Film', 'Director', 2024, 90)", [movieId]);
    await db.query("INSERT INTO scripts (id, movie_id, s3_key) VALUES ($1, $2, 'scripts/film/draft.pdf')", [scriptId, movieId]);
    return { movieId, scriptId };
}

// Version 1 stored a line index beside each box; it must match, because the
// location exclusion constraint of that schema is keyed on it.
function insertV1Scene(db, { id, scriptId, timing, start, end }) {
    const lineOf = (top) => Math.round((top + 12 * 0.82 - 96) / 12);
    return db.query(
        `INSERT INTO captured_scenes (
           id, script_id, start_time_seconds, end_time_seconds,
           start_page, start_line, start_top, start_bottom, start_text,
           end_page, end_line, end_top, end_bottom, end_text, scene_text, raw_text
         ) VALUES ($1,$2,$3,$4,2,$5,$6,$7,'Start',2,$8,$9,$10,'End','Text','Text')`,
        [id, scriptId, ...timing, lineOf(start[0]), ...start, lineOf(end[0]), ...end]
    );
}

function insertV2Scene(db, { scriptId, timing, start, end }) {
    return db.query(
        `INSERT INTO captured_scenes (
           id, script_id, start_time_seconds, end_time_seconds,
           start_page, start_y, end_page, end_y, scene_text
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Text')`,
        [randomUUID(), scriptId, ...timing, ...start, ...end]
    );
}

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
