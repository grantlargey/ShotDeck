import { v4 as uuidv4 } from "uuid";

export async function listAnnotationsForMovie(db, movieId) {
    const result = await db.query(
        `
        SELECT *
        FROM annotations
        WHERE movie_id = $1
        ORDER BY time_seconds ASC, created_at ASC
      `,
        [movieId]
    );

    return result.rows;
}

export async function findAnnotationForMovie(db, { movieId, annotationId }) {
    const result = await db.query(
        `
        SELECT *
        FROM annotations
        WHERE id = $1 AND movie_id = $2
        LIMIT 1
      `,
        [annotationId, movieId]
    );

    return result.rows[0] || null;
}

export async function createAnnotationRecord(db, { movieId, timeSeconds, title, body, imageKey }) {
    const id = uuidv4();
    const result = await db.query(
        `
        INSERT INTO annotations (id, movie_id, time_seconds, title, body, image_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
        [id, movieId, timeSeconds, title, body ?? null, imageKey ?? null]
    );

    return result.rows[0];
}

export async function updateAnnotationRecord(
    db,
    { movieId, annotationId, timeSeconds, title, body, imageKey }
) {
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
        [timeSeconds, title, body, imageKey, annotationId, movieId]
    );

    return result.rows[0] || null;
}

export async function listImageKeysWithoutThumbnails(db) {
    const result = await db.query(
        `
        SELECT DISTINCT image_key
        FROM annotations
        WHERE COALESCE(image_key, '') <> ''
          AND thumb_key IS NULL
      `
    );

    return result.rows.map((row) => row.image_key);
}

/** Only rows still showing that image take the thumbnail, so a replaced image never gets a stale one. */
export async function setThumbnailKeyForImage(db, { imageKey, thumbKey }) {
    await db.query(
        `
        UPDATE annotations
        SET thumb_key = $2
        WHERE image_key = $1
          AND thumb_key IS DISTINCT FROM $2
      `,
        [imageKey, thumbKey]
    );
}

export async function deleteAnnotationRecord(db, { movieId, annotationId }) {
    const result = await db.query(
        `
        DELETE FROM annotations
        WHERE id = $1 AND movie_id = $2
        RETURNING id
      `,
        [annotationId, movieId]
    );

    return result.rows[0] || null;
}
