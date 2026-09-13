/**
 * Movie persistence boundary. Services call these functions instead of
 * embedding SQL, which keeps route logic independent of the database schema.
 */
export async function createMovie(
    db,
    { id, title, director, writer, cinematographer, year, runtimeMinutes, coverImageKey, links }
) {
    const result = await db.query(
        `
        INSERT INTO movies (id, title, director, writer, cinematographer, year, runtime_minutes, cover_image_key, links)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *
      `,
        [
            id,
            title,
            director,
            writer ?? null,
            cinematographer ?? null,
            year,
            runtimeMinutes,
            coverImageKey ?? null,
            JSON.stringify(links),
        ]
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

export async function updateMovie(
    db,
    { id, title, director, writer, cinematographer, year, runtimeMinutes, coverImageKey, links }
) {
    const result = await db.query(
        `
        UPDATE movies
        SET title = $2,
            director = $3,
            writer = $4,
            cinematographer = $5,
            year = $6,
            runtime_minutes = $7,
            cover_image_key = $8,
            links = $9::jsonb
        WHERE id = $1
        RETURNING *
      `,
        [id, title, director, writer, cinematographer, year, runtimeMinutes, coverImageKey, JSON.stringify(links)]
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
