import { v4 as uuidv4 } from "uuid";
import { withFilmWrite } from "./filmWrite.js";
import { SCRIPT_TAG_CATEGORIES } from "../domain/script-tags.js";
import { HttpError } from "../utils/http-error.js";

/*
 * Captured scenes: the module behind routes/script-scenes.routes.js. Its
 * interface is one canonical write and response shape; the implementation
 * owns validation, overlap rules, SQL, locking and response shaping.
 */

const SCENE_NOT_FOUND = "Script scene annotation not found";
const SEARCH_RESULT_LIMIT = 500;
// How many scenes the home page's library reel draws at once.
const SAMPLE_SIZE = 12;
const MAX_INT = 2_147_483_647;
// A page within a screenplay, and a baseline y within a page in PDF points.
const MAX_PAGE = 300;
const MAX_Y = 1000;
const TAXONOMY_TAGS = new Set(SCRIPT_TAG_CATEGORIES.flatMap((category) => category.tags.map((tag) => tag.value)));

const INVALID_BODY = {
    filmTiming:
        "Invalid body. start_time_seconds and end_time_seconds must be integers between 0 and 2147483647 where end >= start.",
    scriptLocation: "Invalid body. script_location must contain start and end scene anchors.",
    sceneAnchor: `Invalid body. Each scene anchor needs a whole page from 1 to ${MAX_PAGE} and a y from 0 to ${MAX_Y}.`,
    reversedPair: "Invalid body. The start anchor must come before or at the end anchor.",
    sceneText: "Invalid body. scene_text must be a non-empty string.",
    tags: "Invalid body. tags must be an array of strings.",
};

const CONFLICT_MESSAGES = {
    film_timing: "This scene's film timing shares a second with another scene in this script.",
    script_location: "This scene's script location overlaps another scene in this script.",
};

/**
 * Creates when `sceneId` is null, otherwise replaces that saved scene.
 * body.script_key must identify the PDF the caller captured, not a key fetched
 * just before saving. A replaced PDF is a 409; an omitted key is a 400.
 */
export async function saveScriptScene(pool, { movieId, scriptId, sceneId = null, body }) {
    const input = readSceneBody(body);
    try {
        return await withFilmWrite(pool, { movieId, scriptId, scriptKey: body?.script_key ?? null }, async (client) => {
            const saved = sceneId ? await findSavedScene(client, { movieId, scriptId, sceneId }) : null;
            if (sceneId && !saved) throw new HttpError(404, SCENE_NOT_FOUND);

            const conflict = await findConflict(client, { scriptId, sceneId, input });
            if (conflict) throw conflict;

            const savedId = await writeScene(client, { scriptId, sceneId: saved?.id, input });
            return sceneFromRow(await fetchSceneRow(client, { movieId, scriptId, sceneId: savedId }));
        });
    } catch (error) {
        if (error?.code !== "23P01") throw error;
        const kind = constraintConflictKind(error.constraint);
        if (!kind) throw error;
        throw conflictError(kind);
    }
}

export async function listScriptScenes(db, { movieId, scriptId }) {
    const result = await db.query(
        `${SCENE_SELECT_SQL}
         WHERE s.movie_id = $1 AND sc.script_id = $2
         ORDER BY sc.start_page, sc.start_y, sc.id`,
        [movieId, scriptId]
    );
    return result.rows.map(sceneFromRow);
}

export async function deleteScriptScene(pool, { movieId, scriptId, sceneId }) {
    await withFilmWrite(pool, { movieId }, async (client) => {
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
        `${TITLED_SCENE_SELECT_SQL}
         ${filter}
         ORDER BY m.title, sc.start_time_seconds, sc.id
         LIMIT ${SEARCH_RESULT_LIMIT}`,
        values
    );
    return result.rows.map(titledSceneFromRow);
}

/** A random handful of scenes from every script, in the search result shape, for the home page's library reel. */
export async function sampleScriptScenes(db) {
    const result = await db.query(`${TITLED_SCENE_SELECT_SQL} ORDER BY random() LIMIT $1`, [SAMPLE_SIZE]);
    return result.rows.map(titledSceneFromRow);
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
    if (compareAnchors(start, end) > 0) throw invalidBody(INVALID_BODY.reversedPair);
    if (!isNonBlankString(fields.scene_text)) throw invalidBody(INVALID_BODY.sceneText);

    return {
        startTime,
        endTime,
        start,
        end,
        sceneText: fields.scene_text,
        tags: readTags(fields.tags),
    };
}

function readAnchor(value) {
    if (
        !Number.isInteger(value.page) ||
        value.page < 1 ||
        value.page > MAX_PAGE ||
        !Number.isFinite(value.y) ||
        value.y < 0 ||
        value.y > MAX_Y
    ) {
        throw invalidBody(INVALID_BODY.sceneAnchor);
    }
    return { page: value.page, y: value.y };
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

function compareAnchors(a, b) {
    return a.page - b.page || a.y - b.y;
}

async function findConflict(db, { scriptId, sceneId, input }) {
    const result = await db.query(
        `SELECT id, start_time_seconds, end_time_seconds,
                start_page, start_y::float8 AS start_y, end_page, end_y::float8 AS end_y
         FROM captured_scenes
         WHERE script_id = $1 AND id IS DISTINCT FROM $2
         ORDER BY start_time_seconds, end_time_seconds, id`,
        [scriptId, sceneId]
    );
    const timing = result.rows.find(
        (other) => other.start_time_seconds <= input.endTime && input.startTime <= other.end_time_seconds
    );
    if (timing) return conflictError("film_timing", timing);

    const location = result.rows.find(
        (other) =>
            compareAnchors(input.start, { page: other.end_page, y: other.end_y }) <= 0 &&
            compareAnchors({ page: other.start_page, y: other.start_y }, input.end) <= 0
    );
    return location ? conflictError("script_location", location) : null;
}

function conflictError(kind, scene) {
    return new HttpError(409, CONFLICT_MESSAGES[kind], {
        conflict_kind: kind,
        conflict_scene_id: scene?.id ?? null,
        conflict_start_time_seconds: scene?.start_time_seconds ?? null,
        conflict_end_time_seconds: scene?.end_time_seconds ?? null,
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
      sc.start_page, sc.start_y::float8 AS start_y,
      sc.end_page, sc.end_y::float8 AS end_y,
      sc.scene_text, sc.tags,
      first_image.id AS first_image_annotation_id,
      first_image.time_seconds::float8 AS first_image_annotation_time_seconds,
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
        -- A scene owns every moment of its end second, so a shot timed to a
        -- tenth stays with the scene it was caught in.
        AND ann.time_seconds < sc.end_time_seconds + 1
      ORDER BY ann.time_seconds
      LIMIT 1
    ) first_image ON TRUE`;

const SCENE_SELECT_SQL = `SELECT ${SCENE_COLUMNS_SQL} ${SCENE_FROM_SQL}`;
// Search and the library sample return each scene with its film's title.
const TITLED_SCENE_SELECT_SQL = `SELECT ${SCENE_COLUMNS_SQL}, m.title AS movie_title
    ${SCENE_FROM_SQL}
    JOIN movies m ON m.id = s.movie_id`;

function sceneFromRow(row) {
    return {
        id: row.id,
        script_id: row.script_id,
        movie_id: row.movie_id,
        start_time_seconds: row.start_time_seconds,
        end_time_seconds: row.end_time_seconds,
        script_location: {
            start: { page: row.start_page, y: row.start_y },
            end: { page: row.end_page, y: row.end_y },
        },
        scene_text: row.scene_text,
        tags: Array.isArray(row.tags) ? row.tags : [],
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

function titledSceneFromRow(row) {
    return { ...sceneFromRow(row), movie_title: row.movie_title };
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

async function writeScene(db, { scriptId, sceneId, input }) {
    const values = [
        scriptId,
        input.startTime,
        input.endTime,
        input.start.page,
        input.start.y,
        input.end.page,
        input.end.y,
        input.sceneText,
        JSON.stringify(input.tags),
    ];
    if (sceneId) {
        await db.query(
            `UPDATE captured_scenes SET
               script_id = $2, start_time_seconds = $3, end_time_seconds = $4,
               start_page = $5, start_y = $6, end_page = $7, end_y = $8,
               scene_text = $9, tags = $10::jsonb
             WHERE id = $1`,
            [sceneId, ...values]
        );
        return sceneId;
    }

    const id = uuidv4();
    await db.query(
        `INSERT INTO captured_scenes (
           id, script_id, start_time_seconds, end_time_seconds,
           start_page, start_y, end_page, end_y, scene_text, tags
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [id, ...values]
    );
    return id;
}
