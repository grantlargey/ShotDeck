import { v4 as uuidv4 } from "uuid";
import { createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { ensureMovieExists } from "./movies.service.js";

/*
 * Scripts: the screenplay PDF attached to a movie, one per movie. This module
 * owns script validation, the script SQL and the script response shape.
 */

/** The script row, with a signed view URL for its PDF or null when signing fails. */
async function withScriptViewUrl(row) {
    if (!row.s3_key) return { ...row, script_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: row.s3_key });
        return { ...row, script_url: url };
    } catch (err) {
        console.error("Failed to sign script URL:", row.s3_key, err?.message);
        return { ...row, script_url: null };
    }
}

/** Saving a movie's script replaces the file of the movie's one script row. */
export async function saveScript(db, movieId, body) {
    const { s3_key } = body || {};
    const trimmedKey = typeof s3_key === "string" ? s3_key.trim() : "";

    if (!trimmedKey || !trimmedKey.startsWith("scripts/")) {
        throw new HttpError(400, "Invalid body. Expected { s3_key:string }");
    }

    await ensureMovieExists(db, movieId);

    const result = await db.query(
        `
        INSERT INTO scripts (id, movie_id, s3_key)
        VALUES ($1, $2, $3)
        ON CONFLICT (movie_id)
        DO UPDATE SET s3_key = EXCLUDED.s3_key
        RETURNING *
      `,
        [uuidv4(), movieId, trimmedKey]
    );
    return withScriptViewUrl(result.rows[0]);
}

export async function listScripts(db, movieId) {
    await ensureMovieExists(db, movieId);
    const result = await db.query(`SELECT * FROM scripts WHERE movie_id = $1`, [movieId]);
    return result.rows[0] ? withScriptViewUrl(result.rows[0]) : null;
}

export async function getScript(db, { movieId, scriptId }) {
    const result = await db.query(`SELECT * FROM scripts WHERE id = $1 AND movie_id = $2`, [
        scriptId,
        movieId,
    ]);
    if (!result.rows[0]) throw new HttpError(404, "Script not found");
    return withScriptViewUrl(result.rows[0]);
}
