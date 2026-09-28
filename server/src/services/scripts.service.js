import { v4 as uuidv4 } from "uuid";
import { withFilmWrite } from "./filmWrite.js";
import { signViewUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { ensureMovieExists } from "./movies.service.js";

/*
 * Scripts: the screenplay PDF attached to a movie, one per movie. This module
 * owns script validation, the script SQL and the script response shape.
 */

/**
 * The script row, with a signed view URL for its PDF and the moment that URL
 * stops working. The viewer holds a script open far longer than one URL lasts,
 * so it needs to know when to ask for another.
 */
async function withScriptViewUrl(row) {
    const script = await signViewUrl(row.s3_key);
    return { ...row, script_url: script.url, script_url_expires_at: script.expiresAt };
}

/**
 * Saving a movie's script replaces the file of the movie's one script row. The
 * API never parses the PDF; the browser reads whatever it needs from the file
 * it already has.
 *
 * A different file makes every captured scene's anchors point into a document
 * that no longer exists, so replacing the PDF deletes the script's scenes and
 * their tags. Saving the same key again is the attachment retry the film-save
 * journal performs after a lost response, and keeps them.
 */
export async function saveScript(pool, movieId, body) {
    const { s3_key } = body || {};
    const trimmedKey = typeof s3_key === "string" ? s3_key.trim() : "";

    if (!trimmedKey || !trimmedKey.startsWith("scripts/")) {
        throw new HttpError(400, "Invalid body. Expected { s3_key:string }");
    }

    const row = await withFilmWrite(pool, { movieId }, async (client) => {
        const existing = await client.query("SELECT id, s3_key FROM scripts WHERE movie_id = $1 FOR UPDATE", [
            movieId,
        ]);
        const previous = existing.rows[0];
        if (previous && previous.s3_key !== trimmedKey) {
            await client.query("DELETE FROM captured_scenes WHERE script_id = $1", [previous.id]);
        }

        const result = await client.query(
            `
            INSERT INTO scripts (id, movie_id, s3_key)
            VALUES ($1, $2, $3)
            ON CONFLICT (movie_id)
            DO UPDATE SET s3_key = EXCLUDED.s3_key
            RETURNING *
          `,
            [uuidv4(), movieId, trimmedKey]
        );
        return result.rows[0];
    });
    return withScriptViewUrl(row);
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
