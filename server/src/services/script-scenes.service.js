import { v4 as uuidv4 } from "uuid";
import { HttpError } from "../utils/http-error.js";

/*
 * Captured scenes: the module behind routes/script-scenes.routes.js. It owns
 * the one write shape, the overlap check, the SQL for the scene and anchor
 * tables, and the response shape.
 *
 * Create and update share saveScriptScene. An update replaces the whole scene
 * and follows the same rules as a create.
 */

const SCENE_NOT_FOUND = "Script scene annotation not found";

/** Search answers at most this many scenes, the most recently updated. */
const SEARCH_RESULT_LIMIT = 500;

/** Creates a scene when `sceneId` is null, and otherwise replaces that saved scene. */
export async function saveScriptScene(pool, { movieId, scriptId, sceneId = null, body }) {
    const input = readSceneBody(body);

    return withTransaction(pool, async (client) => {
        await lockScriptScenes(client, scriptId);
        const saved = sceneId ? await lockSavedScene(client, { movieId, scriptId, sceneId }) : null;
        if (sceneId && !saved) throw new HttpError(404, SCENE_NOT_FOUND);
        if (!sceneId && !(await scriptExists(client, { movieId, scriptId }))) {
            throw new HttpError(404, "Script not found");
        }

        const conflict = await findConflict(client, { movieId, scriptId, sceneId, input });
        if (conflict) throw conflict;

        const savedId = await writeScene(client, { movieId, scriptId, saved, input });
        return sceneFromRow(await fetchSceneRow(client, { movieId, scriptId, sceneId: savedId }));
    });
}

export async function listScriptScenes(db, { movieId, scriptId }) {
    const result = await db.query(
        `${SCENE_SELECT_SQL}
        WHERE sc.movie_id = $1 AND sc.script_id = $2
        ORDER BY COALESCE(a.page_start, 2147483647) ASC, sc.start_time_seconds ASC, sc.created_at ASC`,
        [movieId, scriptId]
    );
    return result.rows.map(sceneFromRow);
}

export async function deleteScriptScene(db, { movieId, scriptId, sceneId }) {
    // Deleting the anchor row deletes its scene row too (ON DELETE CASCADE).
    const result = await db.query(
        `DELETE FROM script_scene_anchors a
        USING script_scene_annotations sc
        WHERE sc.anchor_id = a.id AND sc.id = $1 AND sc.movie_id = $2 AND sc.script_id = $3`,
        [sceneId, movieId, scriptId]
    );
    if (result.rowCount === 0) throw new HttpError(404, SCENE_NOT_FOUND);
}

/** Scenes in every script with all of `tags`, or any of them when `match` is "any". No tags matches every scene. */
export async function searchScriptScenes(db, { tags, match }) {
    const anyTag = match === "any";
    const filter = tags.length === 0 ? "" : anyTag ? "WHERE sc.tags ?| $1::text[]" : "WHERE sc.tags @> $1::jsonb";
    const values = tags.length === 0 ? [] : [anyTag ? tags : JSON.stringify(tags)];

    const result = await db.query(
        `SELECT ${SCENE_COLUMNS_SQL}, m.title AS movie_title
        ${SCENE_FROM_SQL}
        JOIN movies m ON m.id = sc.movie_id
        ${filter}
        ORDER BY sc.updated_at DESC
        LIMIT ${SEARCH_RESULT_LIMIT}`,
        values
    );
    return result.rows.map((row) => ({
        ...sceneFromRow(row),
        ...(row.movie_title ? { movie_title: row.movie_title } : {}),
    }));
}

// The write shape -----------------------------------------------------------

const INVALID_BODY = {
    filmTiming:
        "Invalid body. start_time_seconds and end_time_seconds must be integers where end >= start and start >= 0.",
    pages: "Invalid body. page_start/page_end must be positive integers and page_end >= page_start.",
    context: "Invalid body. context_prefix/context_suffix must be strings when provided.",
    offsets: "Invalid body. start_offset/end_offset must be integers where end_offset >= start_offset >= 0.",
    rawText: "Invalid body. raw_selected_text must be a non-empty string.",
    tags: "Invalid body. tags must be an array of strings.",
    geometry: "Invalid body. anchor_geometry must be a JSON array when provided.",
    sceneAnchor:
        "Invalid body. A version-2 anchor_geometry entry needs kind start or end, version 2, unit pt, a whole page >= 1, a whole line >= 0, finite top and bottom, and text.",
};

/**
 * Validates a whole scene body and reports the first invalid field, in a fixed
 * order. Nothing is coerced: numbers must be JSON numbers, tags a list of
 * strings, and geometry a list.
 */
function readSceneBody(body) {
    const fields = body || {};
    const filmTiming = readIntegerRange(fields.start_time_seconds, fields.end_time_seconds, {
        min: 0,
        required: true,
        message: INVALID_BODY.filmTiming,
    });
    const pages = readIntegerRange(fields.page_start, fields.page_end, { min: 1, message: INVALID_BODY.pages });
    const contextPrefix = readOptionalString(fields.context_prefix, INVALID_BODY.context);
    const contextSuffix = readOptionalString(fields.context_suffix, INVALID_BODY.context);
    const offsets = readIntegerRange(fields.start_offset, fields.end_offset, { min: 0, message: INVALID_BODY.offsets });

    // Raw text falls back to selected text; selected text falls back to formatted text, then raw text.
    const rawSelectedText =
        typeof fields.raw_selected_text === "string"
            ? fields.raw_selected_text
            : typeof fields.selected_text === "string"
                ? fields.selected_text
                : "";
    if (!rawSelectedText.trim()) throw invalidBody(INVALID_BODY.rawText);
    const formattedSelectedText =
        typeof fields.formatted_selected_text === "string" ? fields.formatted_selected_text : null;
    const selectedText = isNonBlankString(fields.selected_text)
        ? fields.selected_text
        : isNonBlankString(formattedSelectedText)
            ? formattedSelectedText
            : rawSelectedText;

    return {
        startTime: filmTiming.start,
        endTime: filmTiming.end,
        pageStart: pages.start,
        pageEnd: pages.end,
        contextPrefix,
        contextSuffix,
        startOffset: offsets.start,
        endOffset: offsets.end,
        selectedText,
        rawSelectedText,
        formattedSelectedText,
        tags: readTags(fields.tags),
        anchorGeometry: readGeometry(fields.anchor_geometry),
    };
}

function invalidBody(message) {
    return new HttpError(400, message);
}

/**
 * Two whole numbers, each at least `min`, where end >= start when both are
 * present. A missing or null value is null, unless the range is required.
 */
function readIntegerRange(start, end, { min, required = false, message }) {
    const read = (value) => {
        if (value === undefined || value === null) {
            if (required) throw invalidBody(message);
            return null;
        }
        if (!Number.isInteger(value) || value < min) throw invalidBody(message);
        return value;
    };
    const range = { start: read(start), end: read(end) };
    if (range.start !== null && range.end !== null && range.end < range.start) throw invalidBody(message);
    return range;
}

function readOptionalString(value, message) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") throw invalidBody(message);
    return value;
}

function isNonBlankString(value) {
    return typeof value === "string" && value.trim() !== "";
}

/** Tags are trimmed and blanks dropped; duplicates and order are kept. */
function readTags(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) {
        throw invalidBody(INVALID_BODY.tags);
    }
    return value.map((tag) => tag.trim()).filter(Boolean);
}

/**
 * Version-2 scene anchors are checked strictly. Other entries are stored as
 * they are sent, because legacy scenes send their stored geometry back.
 */
function readGeometry(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw invalidBody(INVALID_BODY.geometry);
    if (value.some((entry) => isSceneAnchorEntry(entry) && !isValidSceneAnchor(entry))) {
        throw invalidBody(INVALID_BODY.sceneAnchor);
    }
    return value;
}

/** A scene anchor names a kind or a version; the legacy pixel rectangles name neither. */
function isSceneAnchorEntry(entry) {
    return typeof entry === "object" && entry !== null && ("kind" in entry || "version" in entry);
}

function isValidSceneAnchor(entry) {
    return (
        (entry.kind === "start" || entry.kind === "end") &&
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

// Overlap -------------------------------------------------------------------
//
// Captured scenes of one script can't overlap (CONTEXT.md, "Overlapping
// scenes"). Every save takes the script's lock before it checks, so two
// conflicting saves can't both pass the check before either has written.

/** Waits for the lock on one script's captured-scene saves, and holds it until the transaction ends. */
async function lockScriptScenes(db, scriptId) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`captured-scenes:${scriptId}`]);
}

const CONFLICT_MESSAGES = {
    film_timing: "This scene's film timing overlaps another scene in this script.",
};

/**
 * The 409 for the input's first overlap with another scene of the script, or
 * null. Film timings overlap when each starts before the other ends, so scenes
 * that only touch are fine, and a zero-length timing overlaps only a scene that
 * strictly contains it. Other scenes are checked in film timing order.
 */
async function findConflict(db, { movieId, scriptId, sceneId, input }) {
    const result = await db.query(
        `SELECT id, start_time_seconds, end_time_seconds
        FROM script_scene_annotations
        WHERE movie_id = $1 AND script_id = $2 AND id IS DISTINCT FROM $3
        ORDER BY start_time_seconds, end_time_seconds, id`,
        [movieId, scriptId, sceneId]
    );
    const timing = result.rows.find(
        (other) => other.start_time_seconds < input.endTime && input.startTime < other.end_time_seconds
    );
    return timing ? conflictError("film_timing", timing) : null;
}

function conflictError(kind, scene) {
    return new HttpError(409, CONFLICT_MESSAGES[kind], {
        conflict_kind: kind,
        conflict_scene_id: scene.id,
        conflict_start_time_seconds: scene.start_time_seconds,
        conflict_end_time_seconds: scene.end_time_seconds,
    });
}

// Rows ----------------------------------------------------------------------

const SCENE_COLUMNS_SQL = `
      sc.id, sc.anchor_id, sc.movie_id, sc.script_id,
      sc.start_time_seconds, sc.end_time_seconds, sc.tags, sc.created_at, sc.updated_at,
      a.page_start, a.page_end, a.selected_text, a.raw_selected_text, a.formatted_selected_text,
      a.context_prefix, a.context_suffix, a.start_offset, a.end_offset, a.anchor_geometry,
      first_image.id AS first_image_annotation_id,
      first_image.time_seconds AS first_image_annotation_time_seconds,
      first_image.image_key AS first_image_annotation_image_key,
      first_image.thumb_key AS first_image_annotation_thumb_key,
      first_image.created_at AS first_image_annotation_created_at`;

/** A scene, its anchor row, and the earliest still with an image inside its film timing, edges included. */
const SCENE_FROM_SQL = `
    FROM script_scene_annotations sc
    JOIN script_scene_anchors a ON a.id = sc.anchor_id
    LEFT JOIN LATERAL (
      SELECT ann.id, ann.time_seconds, ann.image_key, ann.thumb_key, ann.created_at
      FROM annotations ann
      WHERE ann.movie_id = sc.movie_id
        AND COALESCE(ann.image_key, '') <> ''
        AND ann.time_seconds >= sc.start_time_seconds
        AND ann.time_seconds <= sc.end_time_seconds
      ORDER BY ann.time_seconds ASC, ann.created_at ASC, ann.id ASC
      LIMIT 1
    ) first_image ON TRUE`;

const SCENE_SELECT_SQL = `SELECT ${SCENE_COLUMNS_SQL} ${SCENE_FROM_SQL}`;

function sceneFromRow(row) {
    return {
        id: row.id,
        anchor_id: row.anchor_id,
        movie_id: row.movie_id,
        script_id: row.script_id,
        start_time_seconds: row.start_time_seconds,
        end_time_seconds: row.end_time_seconds,
        tags: Array.isArray(row.tags) ? row.tags : [],
        created_at: row.created_at,
        updated_at: row.updated_at,
        page_start: row.page_start,
        page_end: row.page_end,
        selected_text: row.selected_text,
        raw_selected_text: row.raw_selected_text,
        formatted_selected_text: row.formatted_selected_text,
        context_prefix: row.context_prefix,
        context_suffix: row.context_suffix,
        start_offset: row.start_offset,
        end_offset: row.end_offset,
        anchor_geometry: Array.isArray(row.anchor_geometry) ? row.anchor_geometry : [],
        first_image_annotation: row.first_image_annotation_id
            ? {
                id: row.first_image_annotation_id,
                time_seconds: row.first_image_annotation_time_seconds,
                image_key: row.first_image_annotation_image_key,
                thumb_key: row.first_image_annotation_thumb_key ?? null,
                created_at: row.first_image_annotation_created_at,
            }
            : null,
    };
}

async function fetchSceneRow(db, { movieId, scriptId, sceneId }) {
    const result = await db.query(`${SCENE_SELECT_SQL} WHERE sc.id = $1 AND sc.movie_id = $2 AND sc.script_id = $3`, [
        sceneId,
        movieId,
        scriptId,
    ]);
    return result.rows[0];
}

/** The saved scene's ids, with its row locked so a delete waits for the save to finish. */
async function lockSavedScene(db, { movieId, scriptId, sceneId }) {
    const result = await db.query(
        `SELECT id, anchor_id FROM script_scene_annotations
        WHERE id = $1 AND movie_id = $2 AND script_id = $3
        FOR UPDATE`,
        [sceneId, movieId, scriptId]
    );
    return result.rows[0] ?? null;
}

async function scriptExists(db, { movieId, scriptId }) {
    const result = await db.query(`SELECT 1 FROM scripts WHERE id = $1 AND movie_id = $2`, [scriptId, movieId]);
    return result.rowCount > 0;
}

/** Inserts a new scene's anchor and scene rows, or replaces a saved scene's, and answers the scene id. */
async function writeScene(db, { movieId, scriptId, saved, input }) {
    const location = [
        input.pageStart,
        input.pageEnd,
        input.selectedText,
        input.rawSelectedText,
        input.formattedSelectedText,
        input.contextPrefix,
        input.contextSuffix,
        input.startOffset,
        input.endOffset,
        JSON.stringify(input.anchorGeometry),
    ];
    const timingAndTags = [input.startTime, input.endTime, JSON.stringify(input.tags)];

    if (saved) {
        await db.query(
            `UPDATE script_scene_anchors SET
              page_start = $2, page_end = $3, selected_text = $4, raw_selected_text = $5,
              formatted_selected_text = $6, context_prefix = $7, context_suffix = $8,
              start_offset = $9, end_offset = $10, anchor_geometry = $11::jsonb, updated_at = NOW()
            WHERE id = $1`,
            [saved.anchor_id, ...location]
        );
        await db.query(
            `UPDATE script_scene_annotations SET
              start_time_seconds = $2, end_time_seconds = $3, tags = $4::jsonb, updated_at = NOW()
            WHERE id = $1`,
            [saved.id, ...timingAndTags]
        );
        return saved.id;
    }

    const anchorId = uuidv4();
    const sceneId = uuidv4();
    await db.query(
        `INSERT INTO script_scene_anchors (
          id, movie_id, script_id, page_start, page_end, selected_text, raw_selected_text,
          formatted_selected_text, context_prefix, context_suffix, start_offset, end_offset, anchor_geometry
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
        [anchorId, movieId, scriptId, ...location]
    );
    await db.query(
        `INSERT INTO script_scene_annotations (id, anchor_id, movie_id, script_id, start_time_seconds, end_time_seconds, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [sceneId, anchorId, movieId, scriptId, ...timingAndTags]
    );
    return sceneId;
}

async function withTransaction(pool, work) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {
            // The original error is more useful than a failed rollback.
        });
        throw err;
    } finally {
        client.release();
    }
}
