import "./helpers/guard.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

const newIds = (...names) => Object.fromEntries(names.map((name) => [name, randomUUID()]));
const movie = newIds("plain", "withLinks", "twoScripts");
const script = newIds("main", "other", "twoA", "twoB");
const legacy = newIds("matched", "unmatched");
const still = newIds("plain", "titled", "withBody");
const orphanAnchor = randomUUID();
const scene = newIds(
    "first",
    "sharesLine",
    "overlapsTiming",
    "reversed",
    "emptyGeometry",
    "pixelGeometry",
    "oneSided",
    "malformed",
    "zeroInside",
    "zeroAtEdge",
    "otherScript",
    "scriptDiffers",
    "bothDiffer",
    "noAnchor"
);

const db = new pg.Client({ connectionString: databaseUrl });

async function insert(table, row) {
    const columns = Object.keys(row);
    const values = Object.values(row).map((value) =>
        value !== null && typeof value === "object" ? JSON.stringify(value) : value
    );
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    await db.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`, values);
}

function anchorRow(id, { movieId = movie.plain, scriptId = script.main, geometry, ...columns }) {
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

/** A captured scene: its anchor row (unless `anchor` is null) and its scene row. */
async function insertScene(
    id,
    { movieId = movie.plain, scriptId = script.main, start, end, tags = [TAGS.protagonist], legacyId = null, anchor = {} }
) {
    const anchorId = randomUUID();
    if (anchor) await anchorRow(anchorId, { movieId, scriptId, ...anchor });
    await insert("script_scene_annotations", {
        id,
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

    // The main script. Scenes that share a line or overlap in film timing do so on purpose.
    await insertScene(scene.first, {
        start: 0,
        end: 60,
        legacyId: legacy.matched,
        anchor: {
            geometry: anchorPair({ startPage: 1, startLine: 0, endLine: 4 }),
            start_offset: 10,
            end_offset: 58,
            context_prefix: "FADE IN:",
            context_suffix: "She sits.",
        },
    });
    await insertScene(scene.sharesLine, {
        start: 60,
        end: 120,
        tags: ["Tension", "Tension", TAGS.protagonist],
        anchor: {
            geometry: anchorPair({ startPage: 1, startLine: 4, endLine: 8 }),
            selected_text: "Mara pours the coffee.",
            start_offset: 0,
        },
    });
    await insertScene(scene.overlapsTiming, {
        start: 100,
        end: 150,
        tags: ["Tension"],
        anchor: { geometry: anchorPair({ startPage: 2, startLine: 0, endLine: 3 }), formatted_selected_text: null },
    });
    await insertScene(scene.reversed, {
        start: 200,
        end: 260,
        tags: ["Night scene"],
        anchor: { geometry: anchorPair({ startPage: 3, startLine: 10, endLine: 2 }), raw_selected_text: " \n " },
    });
    await insertScene(scene.zeroInside, {
        start: 230,
        end: 230,
        anchor: { geometry: anchorPair({ startPage: 4, startLine: 0, endLine: 2 }) },
    });
    await insertScene(scene.zeroAtEdge, {
        start: 260,
        end: 260,
        anchor: { geometry: anchorPair({ startPage: 4, startLine: 3, endLine: 12 }) },
    });
    await insertScene(scene.emptyGeometry, { start: 300, end: 310, anchor: { geometry: [] } });
    await insertScene(scene.pixelGeometry, {
        start: 400,
        end: 410,
        anchor: {
            geometry: [
                { x: 72, y: 140, width: 420, height: 14 },
                { x: 72, y: 154, width: 310, height: 14 },
            ],
        },
    });
    await insertScene(scene.oneSided, {
        start: 500,
        end: 510,
        anchor: { geometry: [anchorPair({ startPage: 5 })[0]], selected_text: "", formatted_selected_text: null },
    });
    await insertScene(scene.malformed, {
        start: 600,
        end: 610,
        anchor: { geometry: anchorPair({ startPage: 6 }).map((entry) => ({ ...entry, page: String(entry.page) })) },
    });

    // Another script: the same timing and lines as the first scene, which isn't an overlap.
    await insertScene(scene.otherScript, {
        movieId: movie.withLinks,
        scriptId: script.other,
        start: 0,
        end: 60,
        tags: [TAGS.revelation],
        anchor: { geometry: anchorPair({ startPage: 1, startLine: 0, endLine: 4 }) },
    });

    // Scene rows that don't agree with their anchor rows.
    await insertScene(scene.scriptDiffers, {
        movieId: movie.twoScripts,
        scriptId: script.twoA,
        start: 0,
        end: 10,
        anchor: { scriptId: script.twoB, geometry: anchorPair({ startPage: 7 }) },
    });
    await insertScene(scene.bothDiffer, {
        movieId: movie.twoScripts,
        scriptId: script.twoB,
        start: 0,
        end: 10,
        anchor: { movieId: movie.withLinks, scriptId: script.other, geometry: anchorPair({ startPage: 8 }) },
    });
    await insertScene(scene.noAnchor, { movieId: movie.twoScripts, scriptId: script.twoA, start: 20, end: 30, anchor: null });
    await anchorRow(orphanAnchor, { geometry: anchorPair({ startPage: 9 }) });
}

function runInventory(env) {
    return spawnSync(process.execPath, ["src/tools/inventory.js"], {
        cwd: serverDir,
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 60_000,
    });
}

const figure = (...ids) => ({ count: ids.length, ids: ids.sort() });
const pairs = (...list) => ({
    count: list.length,
    pairs: list.map((pair) => pair.toSorted()).sort((a, b) => (a.join() < b.join() ? -1 : 1)),
});

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

    test("sorts captured scenes by their anchor pair", () => {
        assert.deepEqual(report.captured_scenes, {
            total: 14,
            valid_anchor_pair: 9,
            reversed_anchor_pair: figure(scene.reversed),
            without_valid_anchor_pair: {
                count: 5,
                empty_geometry: figure(scene.emptyGeometry),
                pixel_geometry: figure(scene.pixelGeometry),
                one_sided: figure(scene.oneSided),
                malformed: figure(scene.malformed, scene.noAnchor),
            },
        });
    });

    test("finds scene text that differs or is blank, among scenes with an anchor row", () => {
        assert.deepEqual(report.scene_text, {
            selected_differs_from_formatted: figure(scene.sharesLine),
            blank_formatted: figure(scene.overlapsTiming, scene.oneSided),
            blank_raw: figure(scene.reversed),
            blank_selected: figure(scene.oneSided),
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
            // A zero-length timing overlaps a scene that strictly contains it, and only touches one it starts or ends.
            overlapping_pairs: pairs([scene.sharesLine, scene.overlapsTiming], [scene.reversed, scene.zeroInside]),
            touching_pairs: 2,
        });
    });

    test("pairs scenes of one script whose script locations share a line, but not adjacent lines", () => {
        assert.deepEqual(report.script_location, { overlapping_pairs: pairs([scene.first, scene.sharesLine]) });
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

    test("finds stills with a title or body, and movies with links", () => {
        assert.deepEqual(report.stills, { total: 3, with_title: figure(still.titled), with_body: figure(still.withBody) });
        assert.deepEqual(report.movies, { total: 3, with_links: figure(movie.withLinks) });
    });

    test("finds orphans, and scene and anchor rows whose movie or script differ", () => {
        assert.deepEqual(report.scene_table_pairs, {
            anchors_without_scene: figure(orphanAnchor),
            scenes_without_anchor: figure(scene.noAnchor),
            movie_id_differs: figure(scene.bothDiffer),
            script_id_differs: figure(scene.bothDiffer, scene.scriptDiffers),
        });
    });

    test("finds movies with more than one script", () => {
        assert.deepEqual(report.scripts, { total: 4, movies_with_several_scripts: figure(movie.twoScripts) });
    });
});

test("every query reads in a read-only transaction with a statement timeout, which ends afterwards", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const settings = [];
        const probe = {
            async query(text, values) {
                if (/^\s*SELECT\b/i.test(text)) {
                    const { rows } = await client.query(
                        "SELECT current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS timeout"
                    );
                    settings.push(`${rows[0].read_only} ${rows[0].timeout}`);
                }
                return client.query(text, values);
            },
        };

        assert.deepEqual(await collectInventory(probe), report);
        assert.equal(settings.length, 6);
        assert.deepEqual(new Set(settings), new Set(["on 30s"]));

        const { rows } = await client.query("SELECT current_setting('transaction_read_only') AS read_only");
        assert.equal(rows[0].read_only, "off");
    } finally {
        await client.end();
    }
});
