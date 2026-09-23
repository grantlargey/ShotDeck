import { v4 as uuidv4, validate as isUuid } from "uuid";
import { createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { withMovieWrite } from "./movies.service.js";
import { queueThumbnailsForRows } from "./thumbnails.service.js";

/*
 * Stills: images from a film, each placed at one moment of it. They are stored
 * in the `annotations` table and served under /movies/:movieId/annotations.
 * This module owns still validation, the still SQL and the still response shape.
 *
 * A moment is held to a tenth of a second, and no two shots of a film share
 * one. Two shots caught in the same second are told apart by their tenth, so
 * neither has to be pushed into the next second, where a captured scene ending
 * on the second would lose it to the scene after.
 */

const INVALID_BODY_MESSAGE =
    "Invalid body. Expected { time_seconds:number to a tenth of a second, (optional) image_key:string }";

const TENTHS_PER_SECOND = 10;
// The moment column holds a tenth of a second, under a million seconds.
const MAX_TIME_SECONDS = 999_999.9;

// The stored columns, with the moment read back as a number: node-postgres
// hands back NUMERIC as a string, and every reader of a still treats it as a
// number.
const STILL_COLUMNS_SQL = "id, movie_id, time_seconds::float8 AS time_seconds, image_key, thumb_key";

function toTenths(seconds) {
    return Math.round(seconds * TENTHS_PER_SECOND);
}

function isValidStillBody({ time_seconds, image_key }) {
    return (
        typeof time_seconds === "number" &&
        Number.isFinite(time_seconds) &&
        Math.abs(time_seconds * TENTHS_PER_SECOND - toTenths(time_seconds)) < 1e-6 &&
        time_seconds >= 0 &&
        time_seconds <= MAX_TIME_SECONDS &&
        (image_key === undefined || image_key === null || typeof image_key === "string")
    );
}

/** A moment as the admin types it: HH:MM:SS, with its tenth when it has one. */
function formatMoment(seconds) {
    const tenths = toTenths(seconds);
    const whole = Math.floor(tenths / TENTHS_PER_SECOND);
    const hms = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
    return tenths % TENTHS_PER_SECOND === 0 ? hms : `${hms}.${tenths % TENTHS_PER_SECOND}`;
}

/**
 * The 409 for a moment another shot holds. Nothing here moves a shot the
 * request didn't name, so the message carries what the admin needs to choose
 * the next moment themselves: which tenth of that second is free, or that none
 * is.
 */
async function duplicateTimeError(db, { movieId, seconds, stillId }) {
    const second = Math.floor(seconds);
    const taken = await db.query(
        `SELECT time_seconds::float8 AS time_seconds
         FROM annotations
         WHERE movie_id = $1 AND id IS DISTINCT FROM $2 AND time_seconds >= $3 AND time_seconds < $4`,
        [movieId, stillId, second, second + 1]
    );
    const held = new Set(taken.rows.map((row) => toTenths(row.time_seconds)));
    const moments = Array.from({ length: TENTHS_PER_SECOND }, (_, tenth) => second + tenth / TENTHS_PER_SECOND);
    const free = moments.filter((moment) => !held.has(toTenths(moment)));
    const later = free.find((moment) => moment > seconds);

    const start = `${formatMoment(seconds)} already holds a shot.`;
    if (later !== undefined) {
        return new HttpError(
            409,
            `${start} The next free moment in that second is ${formatMoment(later)}. To place this shot earlier than the ones already there, retime those first.`
        );
    }
    if (free.length > 0) {
        return new HttpError(
            409,
            `${start} Nothing later in that second is free, but ${formatMoment(free[0])} is. To keep this shot after the ones already there, retime those first.`
        );
    }
    return new HttpError(409, `${start} Every tenth of ${formatMoment(second)} is taken, so choose another second.`);
}

async function validateStillTime(db, movie, seconds, stillId) {
    if (seconds > (movie.runtime_minutes + 1) * 60) {
        throw new HttpError(400, "The timestamp cannot exceed the movie's stored runtime plus one minute.");
    }
    const duplicate = await db.query(
        "SELECT 1 FROM annotations WHERE movie_id = $1 AND time_seconds = $2 AND id <> $3 LIMIT 1",
        [movie.id, seconds, stillId]
    );
    if (duplicate.rowCount > 0) throw await duplicateTimeError(db, { movieId: movie.id, seconds, stillId });
}

/** The same conflict, reached through the constraint when two writes race. */
async function stillWriteError(db, moment, error) {
    if (error.code === "23505" && error.constraint === "annotations_movie_time_unique") {
        throw await duplicateTimeError(db, moment);
    }
    throw error;
}

async function signedViewUrl(key) {
    if (!key) return null;

    try {
        const { url } = await createPresignedGetUrl({ key });
        return url;
    } catch (err) {
        console.error("Failed to sign still image URL:", key, err?.message);
        return null;
    }
}

/** The fields the client's still views use, with signed URLs for the image and, once it exists, its thumbnail. */
async function toStillResponse(row) {
    const [imageUrl, thumbUrl] = await Promise.all([signedViewUrl(row.image_key), signedViewUrl(row.thumb_key)]);
    return {
        id: row.id,
        movie_id: row.movie_id,
        time_seconds: row.time_seconds,
        image_key: row.image_key,
        image_url: imageUrl,
        thumb_key: row.thumb_key ?? null,
        thumb_url: thumbUrl,
    };
}

export async function createStill(db, movieId, body) {
    const fields = body ?? {};
    if (!isValidStillBody(fields)) throw new HttpError(400, INVALID_BODY_MESSAGE);
    if (fields.id !== undefined && !isUuid(fields.id)) throw new HttpError(400, "Invalid still id. Expected a UUID.");
    const id = fields.id ?? uuidv4();
    const row = await withMovieWrite(db, movieId, async (client, movie) => {
        // Replaying creation keeps subsequent edits, even if the original time is now occupied.
        const existing = await client.query(
            `SELECT ${STILL_COLUMNS_SQL} FROM annotations WHERE id = $1 AND movie_id = $2`,
            [id, movieId]
        );
        if (existing.rows[0]) return existing.rows[0];
        await validateStillTime(client, movie, fields.time_seconds, id);
        const result = await client.query(
            `
            INSERT INTO annotations (id, movie_id, time_seconds, image_key)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO NOTHING
            RETURNING ${STILL_COLUMNS_SQL}
          `,
            [id, movieId, fields.time_seconds, fields.image_key ?? null]
        );

        // A separate read sees a concurrent insert after the unique constraint
        // finishes waiting. Creation replay never overwrites subsequent edits.
        const saved =
            result.rows[0] ??
            (
                await client.query(`SELECT ${STILL_COLUMNS_SQL} FROM annotations WHERE id = $1 AND movie_id = $2`, [
                    id,
                    movieId,
                ])
            ).rows[0];
        if (!saved) throw new HttpError(409, "Still identity is already in use.");
        return saved;
    }).catch((error) => stillWriteError(db, { movieId, seconds: fields.time_seconds, stillId: id }, error));
    queueThumbnailsForRows(db, [row]);
    return toStillResponse(row);
}

export async function listStills(db, movieId) {
    const result = await db.query(
        `
        SELECT ${STILL_COLUMNS_SQL}
        FROM annotations
        WHERE movie_id = $1
        ORDER BY time_seconds ASC
      `,
        [movieId]
    );

    queueThumbnailsForRows(db, result.rows);
    return Promise.all(result.rows.map(toStillResponse));
}

/** Replaces the time. The image is kept when the body leaves image_key out, and null removes it. */
export async function updateStill(db, { movieId, stillId, body }) {
    const fields = body ?? {};
    if (!isValidStillBody(fields)) throw new HttpError(400, INVALID_BODY_MESSAGE);

    const row = await withMovieWrite(db, movieId, async (client, movie) => {
        const saved = await client.query(`SELECT image_key FROM annotations WHERE id = $1 AND movie_id = $2`, [stillId, movieId]);
        if (!saved.rows[0]) throw new HttpError(404, "Annotation not found");
        await validateStillTime(client, movie, fields.time_seconds, stillId);

        const imageKey = fields.image_key === undefined ? saved.rows[0].image_key : fields.image_key;
        const result = await client.query(
            `
            UPDATE annotations
            SET time_seconds = $1,
                image_key = $2,
                -- A replaced image needs a new thumbnail.
                thumb_key = CASE WHEN image_key IS NOT DISTINCT FROM $2 THEN thumb_key END
            WHERE id = $3 AND movie_id = $4
            RETURNING ${STILL_COLUMNS_SQL}
          `,
            [fields.time_seconds, imageKey, stillId, movieId]
        );
        if (!result.rows[0]) throw new HttpError(404, "Annotation not found");
        return result.rows[0];
    }).catch((error) => stillWriteError(db, { movieId, seconds: fields.time_seconds, stillId }, error));

    queueThumbnailsForRows(db, [row]);
    return toStillResponse(row);
}

export async function deleteStill(db, { movieId, stillId }) {
    const result = await db.query(`DELETE FROM annotations WHERE id = $1 AND movie_id = $2`, [stillId, movieId]);
    if (result.rowCount === 0) throw new HttpError(404, "Annotation not found");
}
