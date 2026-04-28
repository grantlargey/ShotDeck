/**
 * Movie persistence boundary. Services call these functions instead of
 * embedding SQL, which keeps route logic independent of the database schema.
 */
export async function createMovie(db, { id, title, director, year, runtimeMinutes, coverImageKey, links }) {
    const result = await db.query(
        `
        INSERT INTO movies (id, title, director, year, runtime_minutes, cover_image_key, links)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
        [id, title, director, year, runtimeMinutes, coverImageKey ?? null, JSON.stringify(links)]
    );

    return result.rows[0];
}

export async function listMovies(db) {
    const result = await db.query(`SELECT * FROM movies ORDER BY created_at DESC`);
    return result.rows;
}

export async function findMovieById(db, id) {
    const result = await db.query(`SELECT * FROM movies WHERE id = $1`, [id]);
    return result.rows[0] || null;
}

export async function updateMovie(db, { id, title, director, year, runtimeMinutes, coverImageKey, links }) {
    const result = await db.query(
        `
        UPDATE movies
        SET title = $2,
            director = $3,
            year = $4,
            runtime_minutes = $5,
            cover_image_key = $6,
            links = $7::jsonb
        WHERE id = $1
        RETURNING *
      `,
        [id, title, director, year, runtimeMinutes, coverImageKey, JSON.stringify(links)]
    );

    return result.rows[0] || null;
}

export async function deleteMovie(db, id) {
    const result = await db.query(
        `
        DELETE FROM movies
        WHERE id = $1
        RETURNING id
      `,
        [id]
    );

    return result.rows[0] || null;
}
