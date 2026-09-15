/*
 * A one-use, read-only inventory of the data that the canonical captured-scene
 * contract converts (overhaul issues 10 and 11). Issue 18 deletes it after the
 * cutover.
 *
 *   DATABASE_URL=postgres://… node src/tools/inventory.js
 *
 * - Every query runs in one REPEATABLE READ, READ ONLY transaction, begun before
 *   the first query and rolled back at the end, with a statement timeout.
 *   Postgres refuses any write, and all figures come from one snapshot.
 * - It prints JSON with counts, row IDs and tag values only: never scene text,
 *   emails, keys or credentials.
 * - It doesn't read server/.env, so DATABASE_URL must be set.
 *
 * Definitions:
 * - Valid anchor pair: a start and an end entry that each pass the server's
 *   strict version-2 check (overhaul issue 04): kind start or end, version 2,
 *   unit "pt", an integer page >= 1, an integer line >= 0, finite top and
 *   bottom, and string text. Where a kind repeats, its last valid entry counts.
 *   A reversed pair is a valid pair stored with its start after its end.
 * - A scene without a valid pair has, checked in this order:
 *   - empty geometry: `[]`;
 *   - a lenient-only pair: the script viewer's `anchorsFromGeometry` still reads
 *     a pair, because it skips the unit, range and text checks;
 *   - one-sided geometry: the viewer reads only a start or only an end;
 *   - pixel geometry: only the old `{ x, y, width, height }` rectangles;
 *   - malformed geometry: anything else, including a scene with no anchor row.
 * - Blank text is null or only whitespace. Selected text differs from formatted
 *   text only where the formatted text isn't null.
 * - Overlap rules (overhaul spec, Decisions 1) compare scenes of the same
 *   script (`script_scene_annotations.script_id`). Film timings overlap when
 *   a.start < b.end && b.start < a.end, and touch when they don't overlap but
 *   one ends where the other starts. Script locations overlap when their line
 *   ranges share a line; as in issue 04, a range runs from its pair's earlier
 *   anchor to its later one, and only scenes with a valid pair are compared.
 *   A pair of scenes is [lower scene id, higher scene id].
 */
import pg from "pg";
import { SCRIPT_TAG_CATEGORIES } from "../../../client/src/entities/script-scene/model/scriptTagCategories.js";

const STATEMENT_TIMEOUT = "30s";
const TAXONOMY_TAGS = new Set(SCRIPT_TAG_CATEGORIES.flatMap((group) => group.tags.map((tag) => tag.value)));

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function idFigure(ids) {
    return { count: ids.length, ids };
}

function idsWhere(rows, predicate) {
    return idFigure(rows.filter(predicate).map((row) => row.id));
}

function isPixelRectangle(entry) {
    return (
        entry !== null &&
        typeof entry === "object" &&
        ["x", "y", "width", "height"].every((key) => Number.isFinite(entry[key]))
    );
}

/** A version-2 scene anchor as the script viewer reads it (`anchorsFromGeometry`). */
function isReadableAnchor(entry) {
    return (
        entry?.version === 2 &&
        (entry.kind === "start" || entry.kind === "end") &&
        Number.isInteger(entry.page) &&
        Number.isInteger(entry.line) &&
        Number.isFinite(entry.top) &&
        Number.isFinite(entry.bottom)
    );
}

/** A version-2 scene anchor as the server validates it (overhaul issue 04). */
function isValidAnchor(entry) {
    return (
        isReadableAnchor(entry) &&
        entry.unit === "pt" &&
        entry.page >= 1 &&
        entry.line >= 0 &&
        typeof entry.text === "string"
    );
}

/** The last start entry and the last end entry that pass `accepts`. */
function lastAnchors(geometry, accepts) {
    const anchors = { start: null, end: null };
    for (const entry of geometry) {
        if (accepts(entry)) anchors[entry.kind] = entry;
    }
    return anchors;
}

function compareAnchors(left, right) {
    return left.page - right.page || left.line - right.line;
}

/**
 * `{ kind: "valid", reversed, first, last }`, where `first` and `last` are the
 * pair's earlier and later anchors, or the kind of geometry without a valid pair.
 */
function readAnchorPair(geometry) {
    if (!Array.isArray(geometry)) return { kind: "malformed" };
    if (geometry.length === 0) return { kind: "empty_geometry" };
    const valid = lastAnchors(geometry, isValidAnchor);
    if (valid.start && valid.end) {
        const reversed = compareAnchors(valid.start, valid.end) > 0;
        const [first, last] = reversed ? [valid.end, valid.start] : [valid.start, valid.end];
        return { kind: "valid", reversed, first, last };
    }
    const readable = lastAnchors(geometry, isReadableAnchor);
    if (readable.start && readable.end) return { kind: "lenient_only" };
    if (readable.start || readable.end) return { kind: "one_sided" };
    return { kind: geometry.every(isPixelRectangle) ? "pixel_geometry" : "malformed" };
}

function timingsOverlap(a, b) {
    return a.start_time_seconds < b.end_time_seconds && b.start_time_seconds < a.end_time_seconds;
}

function timingsTouch(a, b) {
    return (
        !timingsOverlap(a, b) &&
        (a.end_time_seconds === b.start_time_seconds || b.end_time_seconds === a.start_time_seconds)
    );
}

function locationsOverlap(a, b) {
    return compareAnchors(a.anchors.first, b.anchors.last) <= 0 && compareAnchors(b.anchors.first, a.anchors.last) <= 0;
}

/** Pairs of scenes in the same script that `matches`, from scenes sorted by id. */
function scenePairs(scenes, matches) {
    const pairs = [];
    for (const group of Map.groupBy(scenes, (scene) => scene.script_id).values()) {
        for (let i = 0; i < group.length; i += 1) {
            for (let j = i + 1; j < group.length; j += 1) {
                if (matches(group[i], group[j])) pairs.push([group[i].id, group[j].id]);
            }
        }
    }
    return pairs.sort((a, b) => compareText(a[0], b[0]) || compareText(a[1], b[1]));
}

function pairFigure(pairs) {
    return { count: pairs.length, pairs };
}

function unknownTags(scenes) {
    const scenesByTag = new Map();
    let scenesWithUnknownTags = 0;
    for (const scene of scenes) {
        const tags = Array.isArray(scene.tags) ? scene.tags.map(String) : [];
        const unknown = new Set(tags.filter((tag) => !TAXONOMY_TAGS.has(tag)));
        if (unknown.size > 0) scenesWithUnknownTags += 1;
        for (const tag of unknown) scenesByTag.set(tag, (scenesByTag.get(tag) ?? 0) + 1);
    }
    return {
        scenes_with_unknown_tags: scenesWithUnknownTags,
        unknown: [...scenesByTag]
            .map(([tag, count]) => ({ tag, scenes: count }))
            .sort((a, b) => b.scenes - a.scenes || compareText(a.tag, b.tag)),
    };
}

// Text columns are only compared here, in SQL; no scene text is selected.
const SCENES_SQL = `
    SELECT
        sc.id,
        sc.script_id,
        sc.start_time_seconds,
        sc.end_time_seconds,
        sc.tags,
        a.id IS NOT NULL AS has_anchor_row,
        a.anchor_geometry,
        a.movie_id <> sc.movie_id AS movie_id_differs,
        a.script_id <> sc.script_id AS script_id_differs,
        a.formatted_selected_text <> a.selected_text AS selected_differs_from_formatted,
        COALESCE(a.formatted_selected_text, '') ~ '^[[:space:]]*$' AS blank_formatted,
        COALESCE(a.raw_selected_text, '') ~ '^[[:space:]]*$' AS blank_raw,
        COALESCE(a.selected_text, '') ~ '^[[:space:]]*$' AS blank_selected,
        a.start_offset IS NOT NULL AS has_start_offset,
        a.end_offset IS NOT NULL AS has_end_offset,
        a.context_prefix IS NOT NULL AS has_context_prefix,
        a.context_suffix IS NOT NULL AS has_context_suffix
    FROM script_scene_annotations sc
    LEFT JOIN script_scene_anchors a ON a.id = sc.anchor_id
    ORDER BY sc.id
`;

const LEGACY_SQL = `
    SELECT sa.id, sc.id IS NOT NULL AS matched
    FROM script_annotations sa
    LEFT JOIN script_scene_annotations sc ON sc.legacy_annotation_id = sa.id
    ORDER BY sa.id
`;

const ANCHORS_WITHOUT_SCENE_SQL = `
    SELECT a.id
    FROM script_scene_anchors a
    WHERE NOT EXISTS (SELECT 1 FROM script_scene_annotations sc WHERE sc.anchor_id = a.id)
    ORDER BY a.id
`;

const STILLS_SQL = `SELECT id, title <> '' AS has_title, body IS NOT NULL AS has_body FROM annotations ORDER BY id`;

const MOVIES_SQL = `SELECT id, links <> '[]'::jsonb AS has_links FROM movies ORDER BY id`;

const SCRIPTS_PER_MOVIE_SQL = `SELECT movie_id AS id, count(*)::int AS scripts FROM scripts GROUP BY movie_id ORDER BY movie_id`;

/** Collects the report through `client`, a connected pg client that isn't in a transaction. */
export async function collectInventory(client) {
    // READ ONLY is set before any other query, so Postgres refuses a write from every later one.
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
        const { rows: scenes } = await client.query(SCENES_SQL);
        const { rows: legacy } = await client.query(LEGACY_SQL);
        const { rows: anchorsWithoutScene } = await client.query(ANCHORS_WITHOUT_SCENE_SQL);
        const { rows: stills } = await client.query(STILLS_SQL);
        const { rows: movies } = await client.query(MOVIES_SQL);
        const { rows: scriptsPerMovie } = await client.query(SCRIPTS_PER_MOVIE_SQL);

        const read = scenes.map((scene) => ({
            ...scene,
            anchors: readAnchorPair(scene.has_anchor_row ? scene.anchor_geometry : undefined),
        }));
        const anchored = read.filter((scene) => scene.anchors.kind === "valid");
        const withoutPair = (kind) => idsWhere(read, (scene) => scene.anchors.kind === kind);
        const withAnchorRow = scenes.filter((scene) => scene.has_anchor_row);
        const countWith = (field) => withAnchorRow.filter((scene) => scene[field]).length;

        return {
            script_annotations: {
                total: legacy.length,
                matched: legacy.filter((row) => row.matched).length,
                unmatched: idsWhere(legacy, (row) => !row.matched),
            },
            captured_scenes: {
                total: scenes.length,
                valid_anchor_pair: anchored.length,
                reversed_anchor_pair: idsWhere(anchored, (scene) => scene.anchors.reversed),
                without_valid_anchor_pair: {
                    count: scenes.length - anchored.length,
                    empty_geometry: withoutPair("empty_geometry"),
                    lenient_only: withoutPair("lenient_only"),
                    one_sided: withoutPair("one_sided"),
                    pixel_geometry: withoutPair("pixel_geometry"),
                    malformed: withoutPair("malformed"),
                },
            },
            scene_text: {
                selected_differs_from_formatted: idsWhere(withAnchorRow, (scene) => scene.selected_differs_from_formatted),
                blank_formatted: idsWhere(withAnchorRow, (scene) => scene.blank_formatted),
                blank_raw: idsWhere(withAnchorRow, (scene) => scene.blank_raw),
                blank_selected: idsWhere(withAnchorRow, (scene) => scene.blank_selected),
            },
            offsets_and_context: {
                start_offset: countWith("has_start_offset"),
                end_offset: countWith("has_end_offset"),
                context_prefix: countWith("has_context_prefix"),
                context_suffix: countWith("has_context_suffix"),
            },
            film_timing: {
                overlapping_pairs: pairFigure(scenePairs(scenes, timingsOverlap)),
                touching_pairs: scenePairs(scenes, timingsTouch).length,
            },
            script_location: {
                overlapping_pairs: pairFigure(scenePairs(anchored, locationsOverlap)),
            },
            tags: unknownTags(scenes),
            stills: {
                total: stills.length,
                with_title: idsWhere(stills, (still) => still.has_title),
                with_body: idsWhere(stills, (still) => still.has_body),
            },
            movies: {
                total: movies.length,
                with_links: idsWhere(movies, (movie) => movie.has_links),
            },
            scene_table_pairs: {
                anchors_without_scene: idFigure(anchorsWithoutScene.map((row) => row.id)),
                scenes_without_anchor: idsWhere(scenes, (scene) => !scene.has_anchor_row),
                movie_id_differs: idsWhere(scenes, (scene) => scene.movie_id_differs),
                script_id_differs: idsWhere(scenes, (scene) => scene.script_id_differs),
            },
            scripts: {
                total: scriptsPerMovie.reduce((sum, row) => sum + row.scripts, 0),
                movies_with_several_scripts: idsWhere(scriptsPerMovie, (row) => row.scripts > 1),
            },
        };
    } finally {
        // Ending the connection ends the transaction too, so a failed rollback loses nothing.
        await client.query("ROLLBACK").catch(() => {});
    }
}

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Set DATABASE_URL to the database to inventory; server/.env isn't read.");

    const client = new pg.Client({
        connectionString,
        // As in src/db.js: RDS needs TLS, and the local Docker database has none.
        ssl: connectionString.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : false,
        application_name: "scriptdeck-inventory",
        connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    try {
        const report = await collectInventory(client);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        await client.end();
    }
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(`Inventory failed: ${err.message}`);
        process.exitCode = 1;
    });
}
