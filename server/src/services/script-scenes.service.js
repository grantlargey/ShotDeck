import { v4 as uuidv4 } from "uuid";
import { SCRIPT_TAG_CATEGORIES } from "../domain/script-tags.js";
import { HttpError } from "../utils/http-error.js";

/*
 * Captured scenes: the module behind routes/script-scenes.routes.js. Its
 * interface is one canonical write and response shape; the implementation
 * owns validation, overlap rules, SQL, locking and response shaping.
 */

const SCENE_NOT_FOUND = "Script scene annotation not found";
const SEARCH_RESULT_LIMIT = 500;
const MAX_INT = 2_147_483_647;
const MAX_PAGE_OR_LINE = 100_000;
const TAXONOMY_TAGS = new Set(SCRIPT_TAG_CATEGORIES.flatMap((category) => category.tags.map((tag) => tag.value)));

const INVALID_BODY = {
    filmTiming:
        "Invalid body. start_time_seconds and end_time_seconds must be integers between 0 and 2147483647 where end >= start.",
    scriptLocation: "Invalid body. script_location must contain start and end scene anchors.",
    sceneAnchor:
        "Invalid body. Each scene anchor needs a whole page from 1 to 100000, a whole line from 0 to 100000, finite top and bottom, and text.",
    reversedPair: "Invalid body. The start anchor must come before or on the same line as the end anchor.",
    sceneText: "Invalid body. scene_text must be a non-empty string.",
    rawText: "Invalid body. raw_text must be a non-empty string.",
    tags: "Invalid body. tags must be an array of strings.",
};

const CONFLICT_MESSAGES = {
    film_timing: "This scene's film timing overlaps another scene in this script.",
    script_location: "This scene's script location shares lines with another scene in this script.",
};

/** Creates a scene when `sceneId` is null, and otherwise replaces that saved scene. */
export async function saveScriptScene(pool, { movieId, scriptId, sceneId = null, body }) {
    const input = readSceneBody(body);
    try {
        return await withTransaction(pool, async (client) => {
            await lockScriptScenes(client, scriptId);
            const saved = sceneId ? await findSavedScene(client, { movieId, scriptId, sceneId }) : null;
            if (sceneId && !saved) throw new HttpError(404, SCENE_NOT_FOUND);
            if (!sceneId && !(await scriptExists(client, { movieId, scriptId }))) {
                throw new HttpError(404, "Script not found");
            }

            const conflict = await findConflict(client, { scriptId, sceneId, input });
            if (conflict) throw conflict;

            const savedId = await writeScene(client, { scriptId, sceneId: saved?.id, input });
            return sceneFromRow(await fetchSceneRow(client, { movieId, scriptId, sceneId: savedId }));
        });
    } catch (error) {
        if (error?.code !== "23P01") throw error;
        const kind = constraintConflictKind(error.constraint);
        if (!kind) throw error;
        throw new HttpError(409, CONFLICT_MESSAGES[kind], {
            conflict_kind: kind,
            conflict_scene_id: null,
            conflict_start_time_seconds: null,
            conflict_end_time_seconds: null,
        });
    }
}

export async function listScriptScenes(db, { movieId, scriptId }) {
    const result = await db.query(
        `${SCENE_SELECT_SQL}
         WHERE s.movie_id = $1 AND sc.script_id = $2
         ORDER BY sc.start_page, sc.start_line, sc.id`,
        [movieId, scriptId]
    );
    return result.rows.map(sceneFromRow);
}

export async function deleteScriptScene(pool, { movieId, scriptId, sceneId }) {
    await withTransaction(pool, async (client) => {
        await lockScriptScenes(client, scriptId);
        const result = await client.query(
            `DELETE FROM captured_scenes sc
             USING scripts s
             WHERE sc.script_id = s.id AND sc.id = $1 AND s.movie_id = $2 AND sc.script_id = $3`,
            [sceneId, movieId, scriptId]
        );
        if (result.rowCount === 0) throw new HttpError(404, SCENE_NOT_FOUND);
    });
}

/** Scenes in every script with all of `tags`, or any of them when `match` is "any". */
export async function searchScriptScenes(db, { tags, match }) {
    const anyTag = match === "any";
    const filter = tags.length === 0 ? "" : anyTag ? "WHERE sc.tags ?| $1::text[]" : "WHERE sc.tags @> $1::jsonb";
    const values = tags.length === 0 ? [] : [anyTag ? tags : JSON.stringify(tags)];
    const result = await db.query(
        `SELECT ${SCENE_COLUMNS_SQL}, m.title AS movie_title
         ${SCENE_FROM_SQL}
         JOIN movies m ON m.id = s.movie_id
         ${filter}
         ORDER BY sc.updated_at DESC
         LIMIT ${SEARCH_RESULT_LIMIT}`,
        values
    );
    return result.rows.map((row) => ({ ...sceneFromRow(row), movie_title: row.movie_title }));
}

function readSceneBody(body) {
    const fields = body ?? {};
    const startTime = fields.start_time_seconds;
    const endTime = fields.end_time_seconds;
    if (
        !Number.isInteger(startTime) ||
        !Number.isInteger(endTime) ||
        startTime < 0 ||
        endTime < startTime ||
        startTime > MAX_INT ||
        endTime > MAX_INT
    ) {
        throw invalidBody(INVALID_BODY.filmTiming);
    }

    const location = fields.script_location;
    if (!isPlainObject(location) || !isPlainObject(location.start) || !isPlainObject(location.end)) {
        throw invalidBody(INVALID_BODY.scriptLocation);
    }
    const start = readAnchor(location.start);
    const end = readAnchor(location.end);
    if (compareLines(start, end) > 0) throw invalidBody(INVALID_BODY.reversedPair);
    if (!isNonBlankString(fields.scene_text)) throw invalidBody(INVALID_BODY.sceneText);
    if (!isNonBlankString(fields.raw_text)) throw invalidBody(INVALID_BODY.rawText);

    return {
        startTime,
        endTime,
        start,
        end,
        sceneText: fields.scene_text,
        rawText: fields.raw_text,
        tags: readTags(fields.tags),
    };
}

function readAnchor(value) {
    if (
        !Number.isInteger(value.page) ||
        value.page < 1 ||
        value.page > MAX_PAGE_OR_LINE ||
        !Number.isInteger(value.line) ||
        value.line < 0 ||
        value.line > MAX_PAGE_OR_LINE ||
        !Number.isFinite(value.top) ||
        !Number.isFinite(value.bottom) ||
        typeof value.text !== "string"
    ) {
        throw invalidBody(INVALID_BODY.sceneAnchor);
    }
    return { page: value.page, line: value.line, top: value.top, bottom: value.bottom, text: value.text };
}

function readTags(value) {
    if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) {
        throw invalidBody(INVALID_BODY.tags);
    }
    const tags = [...new Set(value.map((tag) => tag.trim()).filter(Boolean))];
    const unknown = tags.find((tag) => !TAXONOMY_TAGS.has(tag));
    if (unknown) throw invalidBody(`Invalid body. Unknown script tag: ${unknown}`);
    return tags;
}

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value) {
    return typeof value === "string" && value.trim() !== "";
}

function invalidBody(message) {
    return new HttpError(400, message);
}

function compareLines(a, b) {
    return a.page - b.page || a.line - b.line;
}

async function lockScriptScenes(db, scriptId) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('captured-scenes:' || $1::uuid::text, 0))", [
        scriptId,
    ]);
}

async function findConflict(db, { scriptId, sceneId, input }) {
    const result = await db.query(
        `SELECT id, start_time_seconds, end_time_seconds,
                start_page, start_line, end_page, end_line
         FROM captured_scenes
         WHERE script_id = $1 AND id IS DISTINCT FROM $2
         ORDER BY start_time_seconds, end_time_seconds, id`,
        [scriptId, sceneId]
    );
    const timing = result.rows.find(
        (other) => other.start_time_seconds < input.endTime && input.startTime < other.end_time_seconds
    );
    if (timing) return conflictError("film_timing", timing);

    const location = result.rows.find(
        (other) =>
            compareLines(input.start, { page: other.end_page, line: other.end_line }) <= 0 &&
            compareLines({ page: other.start_page, line: other.start_line }, input.end) <= 0
    );
    return location ? conflictError("script_location", location) : null;
}

function conflictError(kind, scene) {
    return new HttpError(409, CONFLICT_MESSAGES[kind], {
        conflict_kind: kind,
        conflict_scene_id: scene.id,
        conflict_start_time_seconds: scene.start_time_seconds,
        conflict_end_time_seconds: scene.end_time_seconds,
    });
}

function constraintConflictKind(constraint) {
    if (constraint === "captured_scenes_no_film_timing_overlap") return "film_timing";
    if (constraint === "captured_scenes_no_script_location_overlap") return "script_location";
    return null;
}

const SCENE_COLUMNS_SQL = `
      sc.id, sc.script_id, s.movie_id,
      sc.start_time_seconds, sc.end_time_seconds,
      sc.start_page, sc.start_line, sc.start_top, sc.start_bottom, sc.start_text,
      sc.end_page, sc.end_line, sc.end_top, sc.end_bottom, sc.end_text,
      sc.scene_text, sc.raw_text, sc.tags, sc.created_at, sc.updated_at,
      first_image.id AS first_image_annotation_id,
      first_image.time_seconds AS first_image_annotation_time_seconds,
      first_image.image_key AS first_image_annotation_image_key,
      first_image.thumb_key AS first_image_annotation_thumb_key`;

const SCENE_FROM_SQL = `
    FROM captured_scenes sc
    JOIN scripts s ON s.id = sc.script_id
    LEFT JOIN LATERAL (
      SELECT ann.id, ann.time_seconds, ann.image_key, ann.thumb_key
      FROM annotations ann
      WHERE ann.movie_id = s.movie_id
        AND COALESCE(ann.image_key, '') <> ''
        AND ann.time_seconds >= sc.start_time_seconds
        AND ann.time_seconds <= sc.end_time_seconds
      ORDER BY ann.time_seconds
      LIMIT 1
    ) first_image ON TRUE`;

const SCENE_SELECT_SQL = `SELECT ${SCENE_COLUMNS_SQL} ${SCENE_FROM_SQL}`;

function sceneFromRow(row) {
    return {
        id: row.id,
        script_id: row.script_id,
        movie_id: row.movie_id,
        start_time_seconds: row.start_time_seconds,
        end_time_seconds: row.end_time_seconds,
        script_location: {
            start: {
                page: row.start_page,
                line: row.start_line,
                top: row.start_top,
                bottom: row.start_bottom,
                text: row.start_text,
            },
            end: {
                page: row.end_page,
                line: row.end_line,
                top: row.end_top,
                bottom: row.end_bottom,
                text: row.end_text,
            },
        },
        scene_text: row.scene_text,
        raw_text: row.raw_text,
        tags: Array.isArray(row.tags) ? row.tags : [],
        created_at: row.created_at,
        updated_at: row.updated_at,
        first_image_annotation: row.first_image_annotation_id
            ? {
                  id: row.first_image_annotation_id,
                  time_seconds: row.first_image_annotation_time_seconds,
                  image_key: row.first_image_annotation_image_key,
                  thumb_key: row.first_image_annotation_thumb_key ?? null,
              }
            : null,
    };
}

async function fetchSceneRow(db, { movieId, scriptId, sceneId }) {
    const result = await db.query(
        `${SCENE_SELECT_SQL} WHERE sc.id = $1 AND s.movie_id = $2 AND sc.script_id = $3`,
        [sceneId, movieId, scriptId]
    );
    return result.rows[0];
}

async function findSavedScene(db, { movieId, scriptId, sceneId }) {
    const result = await db.query(
        `SELECT sc.id
         FROM captured_scenes sc
         JOIN scripts s ON s.id = sc.script_id
         WHERE sc.id = $1 AND s.movie_id = $2 AND sc.script_id = $3`,
        [sceneId, movieId, scriptId]
    );
    return result.rows[0] ?? null;
}

async function scriptExists(db, { movieId, scriptId }) {
    const result = await db.query("SELECT 1 FROM scripts WHERE id = $1 AND movie_id = $2", [scriptId, movieId]);
    return result.rowCount > 0;
}

async function writeScene(db, { scriptId, sceneId, input }) {
    const values = [
        scriptId,
        input.startTime,
        input.endTime,
        input.start.page,
        input.start.line,
        input.start.top,
        input.start.bottom,
        input.start.text,
        input.end.page,
        input.end.line,
        input.end.top,
        input.end.bottom,
        input.end.text,
        input.sceneText,
        input.rawText,
        JSON.stringify(input.tags),
    ];
    if (sceneId) {
        await db.query(
            `UPDATE captured_scenes SET
               script_id = $2, start_time_seconds = $3, end_time_seconds = $4,
               start_page = $5, start_line = $6, start_top = $7, start_bottom = $8, start_text = $9,
               end_page = $10, end_line = $11, end_top = $12, end_bottom = $13, end_text = $14,
               scene_text = $15, raw_text = $16, tags = $17::jsonb, updated_at = NOW()
             WHERE id = $1`,
            [sceneId, ...values]
        );
        return sceneId;
    }

    const id = uuidv4();
    await db.query(
        `INSERT INTO captured_scenes (
           id, script_id, start_time_seconds, end_time_seconds,
           start_page, start_line, start_top, start_bottom, start_text,
           end_page, end_line, end_top, end_bottom, end_text,
           scene_text, raw_text, tags
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
         )`,
        [id, ...values]
    );
    return id;
}

async function withTransaction(pool, work) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
