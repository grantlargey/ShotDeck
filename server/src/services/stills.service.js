import { v4 as uuidv4, validate as isUuid } from "uuid";
import { signViewUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { withFilmWrite } from "./filmWrite.js";
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
// How many stills the home page's library reel draws at once.
const SAMPLE_SIZE = 24;

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

/**
 * The fields the client's still views use, with signed view URLs for the image
 * and, once it exists, its thumbnail, each beside the moment it stops working.
 * A project page stays open far longer than one URL lasts, so a viewer that
 * keeps a still on screen has to know when to ask for a fresh URL.
 */
async function toStillResponse(row) {
    const [image, thumb] = await Promise.all([signViewUrl(row.image_key), signViewUrl(row.thumb_key)]);
    return {
        id: row.id,
        movie_id: row.movie_id,
        time_seconds: row.time_seconds,
        image_key: row.image_key,
        image_url: image.url,
        image_url_expires_at: image.expiresAt,
        thumb_key: row.thumb_key ?? null,
        thumb_url: thumb.url,
        thumb_url_expires_at: thumb.expiresAt,
    };
}

export async function createStill(pool, movieId, body) {
    const fields = body ?? {};
    if (!isValidStillBody(fields)) throw new HttpError(400, INVALID_BODY_MESSAGE);
    if (fields.id !== undefined && !isUuid(fields.id)) throw new HttpError(400, "Invalid still id. Expected a UUID.");
    const id = fields.id ?? uuidv4();
    const row = await withFilmWrite(pool, { movieId }, async (client, movie) => {
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
    }).catch((error) => stillWriteError(pool, { movieId, seconds: fields.time_seconds, stillId: id }, error));
    queueThumbnailsForRows(pool, [row]);
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

/**
 * A random handful of stills with images, across every film, each with its
 * film's title. The home page's library reel shows these without loading any
 * film's full stills list.
 */
export async function sampleStills(db) {
    const result = await db.query(
        `
        SELECT sampled.*, m.title AS movie_title
        FROM (
          SELECT ${STILL_COLUMNS_SQL}
          FROM annotations
          WHERE image_key IS NOT NULL
          -- Stills that already have a thumbnail go first. Without one the reel
          -- pulls the full image into a frame a few hundred pixels wide, which
          -- takes long enough to arrive that the frame drifts past empty. A
          -- still without a thumbnail only stands in while the queue is still
          -- working through a library, so the reel is never empty meanwhile.
          ORDER BY (thumb_key IS NULL), random()
          LIMIT $1
        ) sampled
        JOIN movies m ON m.id = sampled.movie_id
      `,
        [SAMPLE_SIZE]
    );

    queueThumbnailsForRows(db, result.rows);
    return Promise.all(
        result.rows.map(async (row) => ({ ...(await toStillResponse(row)), movie_title: row.movie_title }))
    );
}

/** Replaces the time. The image is kept when the body leaves image_key out, and null removes it. */
export async function updateStill(pool, { movieId, stillId, body }) {
    const fields = body ?? {};
    if (!isValidStillBody(fields)) throw new HttpError(400, INVALID_BODY_MESSAGE);

    const row = await withFilmWrite(pool, { movieId }, async (client, movie) => {
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
    }).catch((error) => stillWriteError(pool, { movieId, seconds: fields.time_seconds, stillId }, error));

    queueThumbnailsForRows(pool, [row]);
    return toStillResponse(row);
}

export async function deleteStill(db, { movieId, stillId }) {
    const result = await db.query(`DELETE FROM annotations WHERE id = $1 AND movie_id = $2`, [stillId, movieId]);
    if (result.rowCount === 0) throw new HttpError(404, "Annotation not found");
}
