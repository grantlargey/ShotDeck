import { v4 as uuidv4 } from "uuid";
import { createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { ensureMovieExists } from "./movies.service.js";
import { queueThumbnailsForRows } from "./thumbnails.service.js";

/*
 * Stills: images from a film, each placed at one moment of it. They are stored
 * in the `annotations` table and served under /movies/:movieId/annotations.
 * This module owns still validation, the still SQL and the still response shape.
 */

const INVALID_BODY_MESSAGE = "Invalid body. Expected { time_seconds:number, (optional) image_key:string }";

function isValidStillBody({ time_seconds, title, body, image_key }, { allowTitleBody = false } = {}) {
    return (
        typeof time_seconds === "number" &&
        Number.isFinite(time_seconds) &&
        time_seconds >= 0 &&
        (!allowTitleBody || title === undefined || title === null || typeof title === "string") &&
        (!allowTitleBody || body === undefined || body === null || typeof body === "string") &&
        (image_key === undefined || image_key === null || typeof image_key === "string")
    );
}

/** The title and body as stored, trimmed. No response includes them. */
function storedTitleAndBody(fields) {
    const title = typeof fields.title === "string" ? fields.title.trim() : "";
    const body = typeof fields.body === "string" && fields.body.trim() ? fields.body.trim() : null;
    return [title, body];
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
        created_at: row.created_at,
    };
}

export async function createStill(db, movieId, body) {
    const fields = body ?? {};
    if (!isValidStillBody(fields)) throw new HttpError(400, INVALID_BODY_MESSAGE);
    await ensureMovieExists(db, movieId);

    const [title, textBody] = storedTitleAndBody(fields);
    const result = await db.query(
        `
        INSERT INTO annotations (id, movie_id, time_seconds, title, body, image_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
        [uuidv4(), movieId, fields.time_seconds, title, textBody, fields.image_key ?? null]
    );

    queueThumbnailsForRows(db, result.rows);
    return toStillResponse(result.rows[0]);
}

export async function listStills(db, movieId) {
    const result = await db.query(
        `
        SELECT *
        FROM annotations
        WHERE movie_id = $1
        ORDER BY time_seconds ASC, created_at ASC
      `,
        [movieId]
    );

    queueThumbnailsForRows(db, result.rows);
    return Promise.all(result.rows.map(toStillResponse));
}

/** Replaces the time, title and body. The image is kept when the body leaves image_key out, and null removes it. */
export async function updateStill(db, { movieId, stillId, body }) {
    const fields = body ?? {};
    if (!isValidStillBody(fields, { allowTitleBody: true })) throw new HttpError(400, INVALID_BODY_MESSAGE);

    const saved = await db.query(`SELECT image_key FROM annotations WHERE id = $1 AND movie_id = $2`, [stillId, movieId]);
    if (!saved.rows[0]) throw new HttpError(404, "Annotation not found");

    const [title, textBody] = storedTitleAndBody(fields);
    const imageKey = fields.image_key === undefined ? saved.rows[0].image_key : fields.image_key;
    const result = await db.query(
        `
        UPDATE annotations
        SET time_seconds = $1,
            title = $2,
            body = $3,
            image_key = $4,
            -- A replaced image needs a new thumbnail.
            thumb_key = CASE WHEN image_key IS NOT DISTINCT FROM $4 THEN thumb_key END
        WHERE id = $5 AND movie_id = $6
        RETURNING *
      `,
        [fields.time_seconds, title, textBody, imageKey, stillId, movieId]
    );
    if (!result.rows[0]) throw new HttpError(404, "Annotation not found");

    queueThumbnailsForRows(db, result.rows);
    return toStillResponse(result.rows[0]);
}

export async function deleteStill(db, { movieId, stillId }) {
    const result = await db.query(`DELETE FROM annotations WHERE id = $1 AND movie_id = $2`, [stillId, movieId]);
    if (result.rowCount === 0) throw new HttpError(404, "Annotation not found");
}
