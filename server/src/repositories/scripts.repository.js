export async function findScriptForMovie(db, { movieId, scriptId }) {
    const result = await db.query(`SELECT * FROM scripts WHERE id = $1 AND movie_id = $2`, [
        scriptId,
        movieId,
    ]);
    return result.rows[0] || null;
}

export async function findLatestScriptForMovie(db, movieId) {
    const result = await db.query(
        `
        SELECT *
        FROM scripts
        WHERE movie_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
        [movieId]
    );
    return result.rows[0] || null;
}

export async function listScriptsForMovie(db, movieId) {
    const result = await db.query(
        `
        SELECT *
        FROM scripts
        WHERE movie_id = $1
        ORDER BY created_at DESC
      `,
        [movieId]
    );

    return result.rows;
}

export async function upsertScriptForMovie(db, { id, movieId, s3Key }) {
    const result = await db.query(
        `
        INSERT INTO scripts (id, movie_id, s3_key)
        VALUES ($1, $2, $3)
        ON CONFLICT (movie_id)
        DO UPDATE SET s3_key = EXCLUDED.s3_key
        RETURNING *
      `,
        [id, movieId, s3Key]
    );

    return result.rows[0];
}
