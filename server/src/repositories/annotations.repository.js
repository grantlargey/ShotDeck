import { v4 as uuidv4 } from "uuid";

export async function ensureMovieExists(db, movieId) {
    const result = await db.query(`SELECT id FROM movies WHERE id = $1`, [movieId]);
    return result.rows[0] || null;
}

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

export async function findAnnotationByNaturalKey(db, { movieId, timeSeconds, title, body }) {
    const result = await db.query(
        `
        SELECT *
        FROM annotations
        WHERE movie_id = $1
          AND time_seconds = $2
          AND title = $3
          AND COALESCE(body, '') = $4
        ORDER BY created_at ASC
        LIMIT 1
      `,
        [movieId, timeSeconds, title, body ?? ""]
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

export async function updateAnnotationImageKey(db, { movieId, annotationId, imageKey }) {
    const result = await db.query(
        `
        UPDATE annotations
        SET image_key = $1
        WHERE id = $2
          AND movie_id = $3
        RETURNING *
      `,
        [imageKey ?? null, annotationId, movieId]
    );

    return result.rows[0] || null;
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
            image_key = $4
        WHERE id = $5 AND movie_id = $6
        RETURNING *
      `,
        [timeSeconds, title, body, imageKey, annotationId, movieId]
    );

    return result.rows[0] || null;
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
