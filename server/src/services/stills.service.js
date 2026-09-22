import { v4 as uuidv4, validate as isUuid } from "uuid";
import { createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { withMovieWrite } from "./movies.service.js";
import { queueThumbnailsForRows } from "./thumbnails.service.js";

/*
 * Stills: images from a film, each placed at one moment of it. They are stored
 * in the `annotations` table and served under /movies/:movieId/annotations.
 * This module owns still validation, the still SQL and the still response shape.
 */

const INVALID_BODY_MESSAGE = "Invalid body. Expected { time_seconds:number, (optional) image_key:string }";

function isValidStillBody({ time_seconds, image_key }) {
    return (
        typeof time_seconds === "number" &&
        Number.isInteger(time_seconds) &&
        time_seconds >= 0 &&
        time_seconds <= 2147483647 &&
        (image_key === undefined || image_key === null || typeof image_key === "string")
    );
}

const DUPLICATE_TIME_MESSAGE = "A shot already exists at this second for this movie. Choose a different timestamp.";

async function validateStillTime(db, movie, seconds, stillId) {
    if (seconds > (movie.runtime_minutes + 1) * 60) {
        throw new HttpError(400, "The timestamp cannot exceed the movie's stored runtime plus one minute.");
    }
    const duplicate = await db.query(
        "SELECT 1 FROM annotations WHERE movie_id = $1 AND time_seconds = $2 AND id <> $3 LIMIT 1",
        [movie.id, seconds, stillId]
    );
    if (duplicate.rowCount > 0) throw new HttpError(409, DUPLICATE_TIME_MESSAGE);
}

function stillWriteError(error) {
    if (error.code === "23505" && error.constraint === "annotations_movie_time_unique") {
        throw new HttpError(409, DUPLICATE_TIME_MESSAGE);
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
        const existing = await client.query("SELECT * FROM annotations WHERE id = $1 AND movie_id = $2", [id, movieId]);
        if (existing.rows[0]) return existing.rows[0];
        await validateStillTime(client, movie, fields.time_seconds, id);
        const result = await client.query(
            `
            INSERT INTO annotations (id, movie_id, time_seconds, image_key)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO NOTHING
            RETURNING *
          `,
            [id, movieId, fields.time_seconds, fields.image_key ?? null]
        );

        // A separate read sees a concurrent insert after the unique constraint
        // finishes waiting. Creation replay never overwrites subsequent edits.
        const saved = result.rows[0] ?? (await client.query("SELECT * FROM annotations WHERE id = $1 AND movie_id = $2", [id, movieId])).rows[0];
        if (!saved) throw new HttpError(409, "Still identity is already in use.");
        return saved;
    }).catch(stillWriteError);
    queueThumbnailsForRows(db, [row]);
    return toStillResponse(row);
}

export async function listStills(db, movieId) {
    const result = await db.query(
        `
        SELECT *
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
            RETURNING *
          `,
            [fields.time_seconds, imageKey, stillId, movieId]
        );
        if (!result.rows[0]) throw new HttpError(404, "Annotation not found");
        return result.rows[0];
    }).catch(stillWriteError);

    queueThumbnailsForRows(db, [row]);
    return toStillResponse(row);
}

export async function deleteStill(db, { movieId, stillId }) {
    const result = await db.query(`DELETE FROM annotations WHERE id = $1 AND movie_id = $2`, [stillId, movieId]);
    if (result.rowCount === 0) throw new HttpError(404, "Annotation not found");
}
