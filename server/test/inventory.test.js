import "./helpers/guard.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { anchorPair, TAGS } from "./helpers/fixtures.js";
import { collectInventory } from "../src/tools/inventory.js";

/*
 * The one-use data inventory, src/tools/inventory.js. Its fixtures live in a
 * schema of their own, so other test files' records in the shared test
 * database don't change the figures.
 *
 * The fixture schema is sql/schema.sql without two rules that the production
 * schema has: one script per movie, and a scene's reference to its anchor row.
 * That lets the tests show the inventory still finds records those rules forbid.
 *
 * IDs are fixed, so the inventory orients every pair the same way on every run.
 * Each boundary case appears in both ID orders, so a rule that checks only one
 * side fails every time.
 */

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "inventory_fixture";

const databaseUrl = (() => {
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${SCHEMA}`);
    return url.toString();
})();

const SCENE_TEXT = "## INT. NIGHT DINER - NIGHT\n\nMara pours the coffee.";
const RAW_TEXT = "INT. NIGHT DINER - NIGHT\nMara pours the coffee.";

/** A fixed UUID. IDs of one `group` sort by `n`. */
const fixedId = (group, n) => `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const movie = { plain: fixedId(1, 1), withLinks: fixedId(1, 2), twoScripts: fixedId(1, 3) };
const script = { main: fixedId(2, 1), other: fixedId(2, 2), twoA: fixedId(2, 3), twoB: fixedId(2, 4) };
const legacy = { matched: fixedId(3, 1), unmatched: fixedId(3, 2) };
const still = { plain: fixedId(4, 1), titled: fixedId(4, 2), withBody: fixedId(4, 3), both: fixedId(4, 4) };
const scene = (n) => fixedId(5, n);
const orphanAnchor = fixedId(6, 1);

const lines = (page, startLine, endLine) => anchorPair({ startPage: page, startLine, endLine });

/*
 * Scenes of the main script. Each case has its own page and its own stretch of
 * film timing, so scenes of different cases never overlap.
 */
const MAIN_SCRIPT_SCENES = [
    // Film timing that touches, with the earlier scene first, then second.
    {
        n: 1,
        start: 1000,
        end: 1060,
        geometry: lines(1, 0, 4),
        tags: ["Tension", "Tension", TAGS.protagonist],
        legacyId: legacy.matched,
        anchor: { start_offset: 10, end_offset: 58, context_prefix: "FADE IN:", context_suffix: "She sits." },
    },
    { n: 2, start: 1060, end: 1120, geometry: lines(1, 10, 14), tags: ["Tension"], anchor: { start_offset: 0 } },
    { n: 3, start: 2060, end: 2120, geometry: lines(2, 0, 4), tags: ["Night scene"] },
    { n: 4, start: 2000, end: 2060, geometry: lines(2, 10, 14) },
    // A zero-length timing strictly inside another scene overlaps it.
    { n: 5, start: 3030, end: 3030, geometry: lines(3, 0, 4) },
    { n: 6, start: 3000, end: 3060, geometry: lines(3, 10, 14) },
    { n: 7, start: 4000, end: 4060, geometry: lines(4, 0, 4) },
    { n: 8, start: 4030, end: 4030, geometry: lines(4, 10, 14) },
    // A zero-length timing at another scene's end, then at its start, only touches it.
    { n: 9, start: 5060, end: 5060, geometry: lines(5, 0, 4) },
    { n: 10, start: 5000, end: 5060, geometry: lines(5, 10, 14) },
    { n: 11, start: 6000, end: 6060, geometry: lines(6, 0, 4) },
    { n: 12, start: 6000, end: 6000, geometry: lines(6, 10, 14) },
    // Script locations that share a boundary line.
    { n: 13, start: 7000, end: 7010, geometry: lines(7, 0, 4) },
    { n: 14, start: 7100, end: 7110, geometry: lines(7, 4, 8) },
    { n: 15, start: 8000, end: 8010, geometry: lines(8, 4, 8) },
    { n: 16, start: 8100, end: 8110, geometry: lines(8, 0, 4) },
    // Script locations on adjacent lines.
    { n: 17, start: 9000, end: 9010, geometry: lines(9, 0, 4) },
    { n: 18, start: 9100, end: 9110, geometry: lines(9, 5, 8) },
    { n: 19, start: 10000, end: 10010, geometry: lines(10, 5, 8) },
    { n: 20, start: 10100, end: 10110, geometry: lines(10, 0, 4) },
    // A range across two pages that contains another.
    {
        n: 21,
        start: 11000,
        end: 11010,
        geometry: anchorPair({ startPage: 11, startLine: 40, endPage: 12, endLine: 3 }),
    },
    { n: 22, start: 11100, end: 11110, geometry: lines(12, 0, 2) },
    // A reversed pair, stored start after end, around another scene's lines.
    { n: 23, start: 12000, end: 12010, geometry: lines(13, 10, 2) },
    { n: 24, start: 12100, end: 12110, geometry: lines(13, 5, 6) },
    // Geometry without a valid pair, carrying scene text variants.
    { n: 25, start: 20000, end: 20010, geometry: [], anchor: { selected_text: "Mara pours the coffee." } },
    {
        n: 26,
        start: 21000,
        end: 21010,
        geometry: [
            { x: 72, y: 140, width: 420, height: 14 },
            { x: 72, y: 154, width: 310, height: 14 },
        ],
        anchor: { formatted_selected_text: null },
    },
    {
        n: 27,
        start: 22000,
        end: 22010,
        geometry: [lines(22, 0, 4)[0]],
        anchor: { formatted_selected_text: "", selected_text: "", raw_selected_text: " \t\n " },
    },
    {
        n: 28,
        start: 23000,
        end: 23010,
        geometry: lines(23, 0, 4).map((entry) => ({ ...entry, page: String(entry.page) })),
        anchor: { formatted_selected_text: " \n", selected_text: " \n", raw_selected_text: "" },
    },
    // Pairs the script viewer reads, but the server's strict version-2 check rejects.
    { n: 29, start: 24000, end: 24010, geometry: lines(0, 0, 4) },
    { n: 30, start: 25000, end: 25010, geometry: lines(30, -1, 3) },
    // No unit, on lines scene 13 also covers: only valid pairs are compared.
    { n: 31, start: 26000, end: 26010, geometry: lines(7, 2, 3).map(({ unit: _unit, ...entry }) => entry) },
    { n: 32, start: 27000, end: 27010, geometry: lines(31, 0, 4).map((entry) => ({ ...entry, text: null })) },
];

const OTHER_SCENES = [
    // Another script: the same timing and lines as scene 1, which isn't an overlap.
    {
        n: 33,
        movieId: movie.withLinks,
        scriptId: script.other,
        start: 1000,
        end: 1060,
        geometry: lines(1, 0, 4),
        tags: [TAGS.revelation],
    },
    // Scene rows that don't agree with their anchor rows, and one without an anchor row.
    {
        n: 34,
        movieId: movie.twoScripts,
        scriptId: script.twoA,
        anchorScriptId: script.twoB,
        start: 0,
        end: 10,
        geometry: lines(1, 0, 4),
    },
    {
        n: 35,
        movieId: movie.twoScripts,
        scriptId: script.twoB,
        anchorMovieId: movie.withLinks,
        anchorScriptId: script.other,
        start: 0,
        end: 10,
        geometry: lines(1, 0, 4),
    },
    { n: 36, movieId: movie.twoScripts, scriptId: script.twoA, start: 20, end: 30, withoutAnchorRow: true },
];

const db = new pg.Client({ connectionString: databaseUrl });

async function insert(table, row) {
    const columns = Object.keys(row);
    const values = Object.values(row).map((value) =>
        value !== null && typeof value === "object" ? JSON.stringify(value) : value
    );
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    await db.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`, values);
}

function insertAnchorRow(id, { movieId, scriptId, geometry, columns = {} }) {
    return insert("script_scene_anchors", {
        id,
        movie_id: movieId,
        script_id: scriptId,
        page_start: 1,
        page_end: 1,
        selected_text: SCENE_TEXT,
        raw_selected_text: RAW_TEXT,
        formatted_selected_text: SCENE_TEXT,
        anchor_geometry: geometry,
        ...columns,
    });
}

/** A captured scene: its anchor row, unless `withoutAnchorRow`, and its scene row. */
async function insertScene({
    n,
    movieId = movie.plain,
    scriptId = script.main,
    anchorMovieId = movieId,
    anchorScriptId = scriptId,
    start,
    end,
    geometry,
    anchor = {},
    tags = [TAGS.protagonist],
    legacyId = null,
    withoutAnchorRow = false,
}) {
    const anchorId = fixedId(7, n);
    if (!withoutAnchorRow) {
        await insertAnchorRow(anchorId, { movieId: anchorMovieId, scriptId: anchorScriptId, geometry, columns: anchor });
    }
    await insert("script_scene_annotations", {
        id: scene(n),
        anchor_id: anchorId,
        legacy_annotation_id: legacyId,
        movie_id: movieId,
        script_id: scriptId,
        start_time_seconds: start,
        end_time_seconds: end,
        tags,
    });
}

async function seed() {
    const movieRow = (id, columns = {}) =>
        insert("movies", { id, title: "Night Diner", director: "Ada Park", year: 2024, runtime_minutes: 118, ...columns });
    await movieRow(movie.plain);
    await movieRow(movie.withLinks, { links: ["https://example.com/review"] });
    await movieRow(movie.twoScripts);

    const scriptRow = (id, movieId) => insert("scripts", { id, movie_id: movieId, s3_key: `scripts/${movieId}/script.pdf` });
    await scriptRow(script.main, movie.plain);
    await scriptRow(script.other, movie.withLinks);
    await scriptRow(script.twoA, movie.twoScripts);
    await scriptRow(script.twoB, movie.twoScripts);

    for (const id of Object.values(legacy)) {
        await insert("script_annotations", {
            id,
            movie_id: movie.plain,
            script_id: script.main,
            start_time_seconds: 0,
            end_time_seconds: 60,
            selected_text: SCENE_TEXT,
            raw_selected_text: RAW_TEXT,
        });
    }

    const stillRow = (id, columns) => insert("annotations", { id, movie_id: movie.plain, time_seconds: 5, ...columns });
    await stillRow(still.plain, { title: "" });
    await stillRow(still.titled, { title: "Old title" });
    await stillRow(still.withBody, { title: "", body: "Old body" });
    await stillRow(still.both, { title: "frame.jpg", body: "frame.jpg" });

    for (const fixture of [...MAIN_SCRIPT_SCENES, ...OTHER_SCENES]) await insertScene(fixture);
    await insertAnchorRow(orphanAnchor, { movieId: movie.plain, scriptId: script.main, geometry: lines(40, 0, 4) });
}

function runInventory(env) {
    return spawnSync(process.execPath, ["src/tools/inventory.js"], {
        cwd: serverDir,
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 60_000,
    });
}

const figure = (...ids) => ({ count: ids.length, ids: ids.toSorted() });
const scenes = (...ns) => figure(...ns.map(scene));
/** Scene pairs given as [lower n, higher n], in order. */
const scenePairs = (...list) => ({ count: list.length, pairs: list.map((pair) => pair.map(scene)) });

/** Every string in `value`, with the key it sits under. */
function stringsIn(value, key = "") {
    if (typeof value === "string") return [{ key, value }];
    if (Array.isArray(value)) return value.flatMap((item) => stringsIn(item, key));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => stringsIn(v, k));
    return [];
}

let run;
let report;

before(async () => {
    await db.connect();
    await db.query(`CREATE SCHEMA ${SCHEMA}`);
    await db.query(await readFile(path.join(serverDir, "sql/schema.sql"), "utf8"));
    await db.query(`
        DROP INDEX idx_scripts_movie_id_unique;
        ALTER TABLE script_scene_annotations DROP CONSTRAINT script_scene_annotations_anchor_id_fkey;
    `);
    await seed();
    run = runInventory({ DATABASE_URL: databaseUrl });
    report = JSON.parse(run.stdout || "null");
});

after(async () => {
    await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await db.end();
});

describe("the inventory command", () => {
    test("prints the report as JSON and exits 0", () => {
        assert.equal(run.status, 0, run.stderr);
        assert.ok(report && typeof report === "object");
    });

    test("prints only counts, IDs and tag values", () => {
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        for (const { key, value } of stringsIn(report)) {
            if (key !== "tag") assert.match(value, UUID, `a string under "${key}" isn't an ID`);
        }
    });

    test("refuses to run without DATABASE_URL, and prints no report", () => {
        const refused = runInventory({ DATABASE_URL: "" });
        assert.equal(refused.status, 1);
        assert.equal(refused.stdout, "");
        assert.match(refused.stderr, /Set DATABASE_URL/);
    });
});

describe("the inventory report", () => {
    test("counts legacy script annotations, matched and unmatched", () => {
        assert.deepEqual(report.script_annotations, { total: 2, matched: 1, unmatched: figure(legacy.unmatched) });
    });

    test("sorts captured scenes by their anchor pair, under the server's strict version-2 check", () => {
        assert.deepEqual(report.captured_scenes, {
            total: 36,
            valid_anchor_pair: 27,
            reversed_anchor_pair: scenes(23),
            without_valid_anchor_pair: {
                count: 9,
                empty_geometry: scenes(25),
                lenient_only: scenes(29, 30, 31, 32),
                one_sided: scenes(27),
                pixel_geometry: scenes(26),
                malformed: scenes(28, 36),
            },
        });
    });

    test("finds scene text that differs, is null, or is empty or whitespace, among scenes with an anchor row", () => {
        // Scenes 27 and 28 give each text column one empty and one whitespace-only value.
        assert.deepEqual(report.scene_text, {
            selected_differs_from_formatted: scenes(25),
            formatted_null: scenes(26),
            formatted_empty_or_whitespace: scenes(27, 28),
            raw_empty_or_whitespace: scenes(27, 28),
            selected_empty_or_whitespace: scenes(27, 28),
        });
    });

    test("counts stored offsets and context", () => {
        assert.deepEqual(report.offsets_and_context, {
            start_offset: 2,
            end_offset: 1,
            context_prefix: 1,
            context_suffix: 1,
        });
    });

    test("pairs scenes of one script whose film timings overlap, and counts those that only touch", () => {
        assert.deepEqual(report.film_timing, {
            overlapping_pairs: scenePairs([5, 6], [7, 8]),
            touching_pairs: 4,
        });
    });

    test("pairs scenes of one script whose valid pairs' line ranges share a line, but not adjacent lines", () => {
        // Scene 23's pair is stored reversed; its range still runs from its earlier anchor to its later one.
        assert.deepEqual(report.script_location, {
            overlapping_pairs: scenePairs([13, 14], [15, 16], [21, 22], [23, 24]),
        });
    });

    test("counts the scenes using each tag outside the taxonomy", () => {
        assert.deepEqual(report.tags, {
            scenes_with_unknown_tags: 3,
            unknown: [
                { tag: "Tension", scenes: 2 },
                { tag: "Night scene", scenes: 1 },
            ],
        });
    });

    test("counts stills with a title or body, without their IDs, and finds movies with links", () => {
        assert.deepEqual(report.stills, { total: 4, with_title: 2, with_body: 2, with_title_or_body: 3 });
        assert.deepEqual(report.movies, { total: 3, with_links: figure(movie.withLinks) });
    });

    test("finds orphans, and scene and anchor rows whose movie or script differ", () => {
        assert.deepEqual(report.scene_table_pairs, {
            anchors_without_scene: figure(orphanAnchor),
            scenes_without_anchor: scenes(36),
            movie_id_differs: scenes(35),
            script_id_differs: scenes(34, 35),
        });
    });

    test("finds movies with more than one script", () => {
        assert.deepEqual(report.scripts, { total: 4, movies_with_several_scripts: figure(movie.twoScripts) });
    });
});

test("sends only a read-only begin, the timeout, six reads under both, and a rollback, in that order", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const statements = [];
        const probe = {
            async query(text, values) {
                const statement = text.trim();
                if (statement.startsWith("SELECT")) {
                    const { rows } = await client.query(
                        "SELECT current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS timeout"
                    );
                    statements.push(`SELECT (read only ${rows[0].read_only}, timeout ${rows[0].timeout})`);
                } else {
                    statements.push(statement);
                }
                return client.query(text, values);
            },
        };

        assert.deepEqual(await collectInventory(probe), report);
        assert.deepEqual(statements, [
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
            "SET LOCAL statement_timeout = '30s'",
            ...Array(6).fill("SELECT (read only on, timeout 30s)"),
            "ROLLBACK",
        ]);

        const { rows } = await client.query("SELECT current_setting('transaction_read_only') AS read_only");
        assert.equal(rows[0].read_only, "off");
    } finally {
        await client.end();
    }
});
