import { fileURLToPath } from "node:url";
import pg from "pg";
import { SCRIPT_TAG_CATEGORIES } from "../domain/script-tags.js";

const STATEMENT_TIMEOUT = "30s";
const MAX_INT = 2_147_483_647;
const MAX_PAGE_OR_LINE = 100_000;
const TAXONOMY_TAGS = new Set(SCRIPT_TAG_CATEGORIES.flatMap((category) => category.tags.map((tag) => tag.value)));
const CAPTURED_SCENES_SCHEMA_SQL = `
  CREATE TABLE captured_scenes (
    id UUID PRIMARY KEY,
    script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    start_time_seconds INT NOT NULL CHECK (start_time_seconds >= 0),
    end_time_seconds INT NOT NULL CHECK (end_time_seconds >= start_time_seconds),
    start_page INT NOT NULL CHECK (start_page BETWEEN 1 AND 100000),
    start_line INT NOT NULL CHECK (start_line BETWEEN 0 AND 100000),
    start_top DOUBLE PRECISION NOT NULL
      CHECK (start_top > '-Infinity'::float8 AND start_top < 'Infinity'::float8),
    start_bottom DOUBLE PRECISION NOT NULL
      CHECK (start_bottom > '-Infinity'::float8 AND start_bottom < 'Infinity'::float8),
    start_text TEXT NOT NULL,
    end_page INT NOT NULL CHECK (end_page BETWEEN 1 AND 100000),
    end_line INT NOT NULL CHECK (end_line BETWEEN 0 AND 100000),
    end_top DOUBLE PRECISION NOT NULL
      CHECK (end_top > '-Infinity'::float8 AND end_top < 'Infinity'::float8),
    end_bottom DOUBLE PRECISION NOT NULL
      CHECK (end_bottom > '-Infinity'::float8 AND end_bottom < 'Infinity'::float8),
    end_text TEXT NOT NULL,
    scene_text TEXT NOT NULL CHECK (scene_text ~ '[^[:space:]]'),
    raw_text TEXT NOT NULL CHECK (raw_text ~ '[^[:space:]]'),
    tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location_start_key BIGINT
      GENERATED ALWAYS AS (start_page::bigint * 1000000 + start_line) STORED,
    location_end_key BIGINT
      GENERATED ALWAYS AS (end_page::bigint * 1000000 + end_line) STORED,
    CONSTRAINT captured_scenes_anchors_ordered
      CHECK ((start_page, start_line) <= (end_page, end_line)),
    CONSTRAINT captured_scenes_no_film_timing_overlap
      EXCLUDE USING gist (
        script_id WITH =,
        int4range(start_time_seconds, end_time_seconds, '[)') WITH &&
      ) WHERE (start_time_seconds < end_time_seconds),
    CONSTRAINT captured_scenes_no_script_location_overlap
      EXCLUDE USING gist (
        script_id WITH =,
        int8range(location_start_key, location_end_key, '[]') WITH &&
      )
  );
  CREATE INDEX captured_scenes_script_location_idx
    ON captured_scenes (script_id, start_page, start_line);
  CREATE INDEX captured_scenes_tags_idx ON captured_scenes USING GIN (tags);
`;

const ABORT_ORDER = [
    "no_valid_anchor_pair",
    "invalid_anchor_entry",
    "unmapped_tag",
    "film_timing_overlap",
    "script_location_overlap",
    "orphan_anchor",
    "orphan_scene",
    "script_movie_mismatch",
    "blank_scene_text",
    "blank_raw_text",
    "location_out_of_range",
];

function baseReport(status) {
    return {
        status,
        scanned: { captured_scenes: 0, script_annotations: 0 },
        converted: { captured_scenes: 0 },
        raw_text: { from_stored: 0 },
        tags: { kept: 0 },
        film_timing: { zero_length: 0, touching_pairs: 0 },
        dropped: { script_annotations: 0, stills_with_title_or_body: 0, movies_with_links: 0 },
        aborts: [],
    };
}

function sortedUnique(values) {
    return [...new Set(values)].sort();
}

function sortedPairs(pairs) {
    const seen = new Set();
    const result = [];
    for (const pair of pairs) {
        const ordered = pair.toSorted();
        const key = ordered.join(":");
        if (!seen.has(key)) {
            seen.add(key);
            result.push(ordered);
        }
    }
    return result.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

function isNonBlankString(value) {
    return typeof value === "string" && value.trim() !== "";
}

function isSceneAnchorEntry(entry) {
    return typeof entry === "object" && entry !== null && ("kind" in entry || "version" in entry);
}

function isValidLegacyAnchor(entry) {
    return (
        (entry?.kind === "start" || entry?.kind === "end") &&
        entry.version === 2 &&
        entry.unit === "pt" &&
        Number.isInteger(entry.page) &&
        entry.page >= 1 &&
        Number.isInteger(entry.line) &&
        entry.line >= 0 &&
        Number.isFinite(entry.top) &&
        Number.isFinite(entry.bottom) &&
        typeof entry.text === "string"
    );
}

function compareLines(a, b) {
    return a.page - b.page || a.line - b.line;
}

function anchorsFromGeometry(geometry) {
    const anchors = {};
    let invalidEntry = false;
    for (const entry of Array.isArray(geometry) ? geometry : []) {
        if (isSceneAnchorEntry(entry) && !isValidLegacyAnchor(entry)) invalidEntry = true;
        if (isValidLegacyAnchor(entry)) anchors[entry.kind] = entry;
    }
    const pair = anchors.start && anchors.end && compareLines(anchors.start, anchors.end) <= 0 ? anchors : null;
    return { pair, invalidEntry };
}

function inCanonicalBounds(scene, pair) {
    return (
        Number.isInteger(scene.start_time_seconds) &&
        Number.isInteger(scene.end_time_seconds) &&
        scene.start_time_seconds >= 0 &&
        scene.end_time_seconds >= scene.start_time_seconds &&
        scene.start_time_seconds <= MAX_INT &&
        scene.end_time_seconds <= MAX_INT &&
        (!pair ||
            (pair.start.page <= MAX_PAGE_OR_LINE &&
                pair.start.line <= MAX_PAGE_OR_LINE &&
                pair.end.page <= MAX_PAGE_OR_LINE &&
                pair.end.line <= MAX_PAGE_OR_LINE))
    );
}

function dedupeTags(tags) {
    return [...new Set(Array.isArray(tags) ? tags : [])];
}

function printableTag(tag) {
    if (typeof tag === "string") return tag;
    if (tag === null) return "<null>";
    return `<${Array.isArray(tag) ? "array" : typeof tag}>`;
}

function pairwise(rows, predicate) {
    const pairs = [];
    for (let left = 0; left < rows.length; left += 1) {
        for (let right = left + 1; right < rows.length; right += 1) {
            if (rows[left].script_id === rows[right].script_id && predicate(rows[left], rows[right])) {
                pairs.push([rows[left].id, rows[right].id]);
            }
        }
    }
    return sortedPairs(pairs);
}

function tagAbort(unknownTags) {
    const values = [...unknownTags.entries()]
        .map(([tag, ids]) => ({ tag, ids: sortedUnique(ids) }))
        .sort((a, b) => a.tag.localeCompare(b.tag));
    return { reason: "unmapped_tag", count: values.length, values };
}

function listAbort(reason, ids) {
    const sorted = sortedUnique(ids);
    return { reason, count: sorted.length, ids: sorted };
}

function pairAbort(reason, pairs) {
    const sorted = sortedPairs(pairs);
    return { reason, count: sorted.length, pairs: sorted };
}

/** Pure conversion analysis: returns insertable rows plus a counts-and-IDs-only report. */
export function analyzeLegacy({ scenes, anchors, scripts, scriptAnnotationCount, dropped }) {
    const report = baseReport("would_convert");
    report.scanned.captured_scenes = scenes.length;
    report.scanned.script_annotations = scriptAnnotationCount;
    report.dropped = {
        script_annotations: scriptAnnotationCount,
        stills_with_title_or_body: dropped.stillsWithTitleOrBody,
        movies_with_links: dropped.moviesWithLinks,
    };

    const scriptById = new Map(scripts.map((script) => [script.id, script]));
    const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
    const referencedAnchorIds = new Set(scenes.map((scene) => scene.anchor_id));
    const abortIds = Object.fromEntries(
        [
            "no_valid_anchor_pair",
            "invalid_anchor_entry",
            "orphan_anchor",
            "orphan_scene",
            "script_movie_mismatch",
            "blank_scene_text",
            "blank_raw_text",
            "location_out_of_range",
        ].map((reason) => [reason, []])
    );
    const unknownTags = new Map();
    const converted = [];

    for (const anchor of anchors) {
        if (!referencedAnchorIds.has(anchor.id)) abortIds.orphan_anchor.push(anchor.id);
    }

    for (const scene of scenes) {
        const anchor = anchorById.get(scene.anchor_id);
        if (!anchor) abortIds.orphan_scene.push(scene.id);
        const { pair, invalidEntry } = anchorsFromGeometry(anchor?.anchor_geometry);
        if (!pair) abortIds.no_valid_anchor_pair.push(scene.id);
        if (invalidEntry) abortIds.invalid_anchor_entry.push(scene.id);

        const script = scriptById.get(scene.script_id);
        if (
            !script ||
            script.movie_id !== scene.movie_id ||
            (anchor && (anchor.script_id !== scene.script_id || anchor.movie_id !== scene.movie_id))
        ) {
            abortIds.script_movie_mismatch.push(scene.id);
        }
        if (anchor && !isNonBlankString(anchor.formatted_selected_text)) abortIds.blank_scene_text.push(scene.id);
        if (anchor && !isNonBlankString(anchor.raw_selected_text)) abortIds.blank_raw_text.push(scene.id);
        if (!inCanonicalBounds(scene, pair)) abortIds.location_out_of_range.push(scene.id);

        const tags = dedupeTags(scene.tags);
        for (const tag of tags) {
            if (typeof tag === "string" && TAXONOMY_TAGS.has(tag)) continue;
            const shown = printableTag(tag);
            if (!unknownTags.has(shown)) unknownTags.set(shown, []);
            unknownTags.get(shown).push(scene.id);
        }
        report.tags.kept += tags.filter((tag) => typeof tag === "string" && TAXONOMY_TAGS.has(tag)).length;
        if (isNonBlankString(anchor?.raw_selected_text)) report.raw_text.from_stored += 1;
        if (scene.start_time_seconds === scene.end_time_seconds) report.film_timing.zero_length += 1;

        converted.push({
            id: scene.id,
            script_id: scene.script_id,
            start_time_seconds: scene.start_time_seconds,
            end_time_seconds: scene.end_time_seconds,
            start: pair?.start,
            end: pair?.end,
            scene_text: anchor?.formatted_selected_text,
            raw_text: anchor?.raw_selected_text,
            tags,
            created_at: scene.created_at,
            updated_at: scene.updated_at,
        });
    }

    const filmPairs = pairwise(
        converted,
        (a, b) => a.start_time_seconds < b.end_time_seconds && b.start_time_seconds < a.end_time_seconds
    );
    const locationPairs = pairwise(
        converted.filter((scene) => scene.start && scene.end),
        (a, b) => compareLines(a.start, b.end) <= 0 && compareLines(b.start, a.end) <= 0
    );
    const touchingPairs = pairwise(
        converted,
        (a, b) => a.end_time_seconds === b.start_time_seconds || b.end_time_seconds === a.start_time_seconds
    );
    report.film_timing.touching_pairs = touchingPairs.length;

    const abortByReason = {
        no_valid_anchor_pair: listAbort("no_valid_anchor_pair", abortIds.no_valid_anchor_pair),
        invalid_anchor_entry: listAbort("invalid_anchor_entry", abortIds.invalid_anchor_entry),
        unmapped_tag: tagAbort(unknownTags),
        film_timing_overlap: pairAbort("film_timing_overlap", filmPairs),
        script_location_overlap: pairAbort("script_location_overlap", locationPairs),
        orphan_anchor: listAbort("orphan_anchor", abortIds.orphan_anchor),
        orphan_scene: listAbort("orphan_scene", abortIds.orphan_scene),
        script_movie_mismatch: listAbort("script_movie_mismatch", abortIds.script_movie_mismatch),
        blank_scene_text: listAbort("blank_scene_text", abortIds.blank_scene_text),
        blank_raw_text: listAbort("blank_raw_text", abortIds.blank_raw_text),
        location_out_of_range: listAbort("location_out_of_range", abortIds.location_out_of_range),
    };
    report.aborts = ABORT_ORDER.map((reason) => abortByReason[reason]).filter((abort) => abort.count > 0);
    return { report, converted };
}

async function tableState(db) {
    const result = await db.query(
        `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS has_migrations,
                to_regclass('public.captured_scenes') IS NOT NULL AS has_captured_scenes,
                to_regclass('public.script_annotations') IS NOT NULL AS has_script_annotations,
                to_regclass('public.script_scene_annotations') IS NOT NULL AS has_scene_annotations,
                to_regclass('public.script_scene_anchors') IS NOT NULL AS has_scene_anchors`
    );
    const state = result.rows[0];
    if (state.has_migrations) {
        const version = await db.query("SELECT 1 FROM schema_migrations WHERE version = 1");
        state.versionOne = version.rowCount > 0;
    } else {
        state.versionOne = false;
    }
    return state;
}

function isConvertible(state) {
    return (
        !state.has_captured_scenes &&
        state.has_script_annotations &&
        state.has_scene_annotations &&
        state.has_scene_anchors &&
        !state.versionOne
    );
}

async function readLegacy(db) {
    const [scenes, anchors, scripts, annotationCount, stills, movies] = await Promise.all([
        db.query("SELECT * FROM script_scene_annotations ORDER BY id"),
        db.query("SELECT * FROM script_scene_anchors ORDER BY id"),
        db.query("SELECT id, movie_id FROM scripts ORDER BY id"),
        db.query("SELECT count(*)::int AS count FROM script_annotations"),
        db.query("SELECT count(*)::int AS count FROM annotations WHERE title <> '' OR body IS NOT NULL"),
        db.query("SELECT count(*)::int AS count FROM movies WHERE links <> '[]'::jsonb"),
    ]);
    return {
        scenes: scenes.rows,
        anchors: anchors.rows,
        scripts: scripts.rows,
        scriptAnnotationCount: annotationCount.rows[0].count,
        dropped: {
            stillsWithTitleOrBody: stills.rows[0].count,
            moviesWithLinks: movies.rows[0].count,
        },
    };
}

async function createCanonicalStorage(db) {
    await db.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await db.query(CAPTURED_SCENES_SCHEMA_SQL);
}

const INSERT_SCENE_SQL = `
  INSERT INTO captured_scenes (
    id, script_id, start_time_seconds, end_time_seconds,
    start_page, start_line, start_top, start_bottom, start_text,
    end_page, end_line, end_top, end_bottom, end_text,
    scene_text, raw_text, tags, created_at, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19
  )`;

function insertValues(scene) {
    return [
        scene.id,
        scene.script_id,
        scene.start_time_seconds,
        scene.end_time_seconds,
        scene.start.page,
        scene.start.line,
        scene.start.top,
        scene.start.bottom,
        scene.start.text,
        scene.end.page,
        scene.end.line,
        scene.end.top,
        scene.end.bottom,
        scene.end.text,
        scene.scene_text,
        scene.raw_text,
        JSON.stringify(scene.tags),
        scene.created_at,
        scene.updated_at,
    ];
}

async function conflictAfterConstraint(db, scene, constraint) {
    const location = constraint === "captured_scenes_no_script_location_overlap";
    const result = await db.query(
        location
            ? `SELECT id FROM captured_scenes
               WHERE script_id = $1
                 AND location_start_key <= $3::bigint * 1000000 + $4
                 AND $2::bigint * 1000000 + $5 <= location_end_key
               ORDER BY id LIMIT 1`
            : `SELECT id FROM captured_scenes
               WHERE script_id = $1
                 AND start_time_seconds < $3
                 AND $2 < end_time_seconds
               ORDER BY id LIMIT 1`,
        location
            ? [scene.script_id, scene.start.page, scene.end.page, scene.end.line, scene.start.line]
            : [scene.script_id, scene.start_time_seconds, scene.end_time_seconds]
    );
    const kind = location ? "script_location_overlap" : "film_timing_overlap";
    return pairAbort(kind, result.rows[0] ? [[scene.id, result.rows[0].id]] : [[scene.id, scene.id]]);
}

async function insertConvertedRows(db, converted) {
    for (const scene of converted) {
        await db.query("SAVEPOINT insert_captured_scene");
        try {
            await db.query(INSERT_SCENE_SQL, insertValues(scene));
            await db.query("RELEASE SAVEPOINT insert_captured_scene");
        } catch (error) {
            await db.query("ROLLBACK TO SAVEPOINT insert_captured_scene");
            if (error?.code !== "23P01") throw error;
            const abort = await conflictAfterConstraint(db, scene, error.constraint);
            await db.query("RELEASE SAVEPOINT insert_captured_scene");
            return abort;
        }
    }
    return null;
}

async function finishConversion(db, report) {
    await db.query(`DROP TABLE script_annotations, script_scene_annotations, script_scene_anchors`);
    await db.query(`ALTER TABLE annotations DROP COLUMN title, DROP COLUMN body`);
    await db.query(`ALTER TABLE movies DROP COLUMN links`);
    // Long-lived legacy databases predate these inline schema checks. Add them
    // while baselining so the converted and fresh version-1 catalogs agree.
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'annotations_time_seconds_check'
            AND conrelid = 'annotations'::regclass
        ) THEN
          ALTER TABLE annotations
            ADD CONSTRAINT annotations_time_seconds_check CHECK (time_seconds >= 0);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'movies_year_check' AND conrelid = 'movies'::regclass
        ) THEN
          ALTER TABLE movies ADD CONSTRAINT movies_year_check CHECK (year >= 1888);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'movies_runtime_minutes_check' AND conrelid = 'movies'::regclass
        ) THEN
          ALTER TABLE movies ADD CONSTRAINT movies_runtime_minutes_check CHECK (runtime_minutes > 0);
        END IF;
      END $$
    `);
    await db.query(`DROP INDEX IF EXISTS idx_scripts_id_movie`);
    await db.query(`DROP INDEX IF EXISTS idx_scripts_movie_created`);
    await db.query(`
      CREATE TABLE schema_migrations (
        version INT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query("INSERT INTO schema_migrations (version, name) VALUES (1, $1)", [
        "0001_canonical_schema (converted from legacy storage)",
    ]);
    const count = await db.query("SELECT count(*)::int AS count FROM captured_scenes");
    if (count.rows[0].count !== report.scanned.captured_scenes) {
        throw new Error("Converted captured-scene count does not match the scanned count.");
    }
}

/** Runs inside a caller-owned connected client and returns `{ code, report }`. */
export async function convertCapturedScenes(db, { check = false } = {}) {
    await db.query(check ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    let finished = false;
    try {
        await db.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
        if (!check) await db.query("SELECT pg_advisory_xact_lock(hashtextextended('convert-captured-scenes', 0))");
        const state = await tableState(db);
        if (state.versionOne) {
            await db.query("ROLLBACK");
            finished = true;
            return { code: 0, report: baseReport("already_converted") };
        }
        if (!isConvertible(state)) {
            await db.query("ROLLBACK");
            finished = true;
            return { code: 2, report: baseReport("not_convertible") };
        }

        const { report, converted } = analyzeLegacy(await readLegacy(db));
        if (report.aborts.length > 0) {
            report.status = check ? "would_abort" : "aborted";
            await db.query("ROLLBACK");
            finished = true;
            return { code: 3, report };
        }
        if (check) {
            report.status = "would_convert";
            await db.query("ROLLBACK");
            finished = true;
            return { code: 0, report };
        }

        await createCanonicalStorage(db);
        const constraintAbort = await insertConvertedRows(db, converted);
        if (constraintAbort) {
            report.status = "aborted";
            report.aborts = [constraintAbort];
            await db.query("ROLLBACK");
            finished = true;
            return { code: 3, report };
        }
        await finishConversion(db, report);
        report.status = "converted";
        report.converted.captured_scenes = converted.length;
        await db.query("COMMIT");
        finished = true;
        return { code: 0, report };
    } finally {
        if (!finished) await db.query("ROLLBACK").catch(() => {});
    }
}

function usage() {
    console.error("Usage: node src/tools/convert-captured-scenes.js [--check]");
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
        usage();
        return 1;
    }
    if (!process.env.DATABASE_URL) {
        console.error("Set DATABASE_URL before running the captured-scene conversion.");
        return 1;
    }

    const useSsl = process.env.DATABASE_URL.includes("rds.amazonaws.com");
    const client = new pg.Client({
        connectionString: process.env.DATABASE_URL,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
    });
    try {
        await client.connect();
        const result = await convertCapturedScenes(client, { check: args[0] === "--check" });
        console.log(JSON.stringify(result.report, null, 2));
        return result.code;
    } catch (error) {
        console.error(`Captured-scene conversion failed: ${error?.message || "database error"}`);
        return 4;
    } finally {
        await client.end().catch(() => {});
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
    process.exitCode = await main();
}
