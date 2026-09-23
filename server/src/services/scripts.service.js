import { v4 as uuidv4 } from "uuid";
import { withTransaction } from "../db.js";
import { createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { ensureMovieExists } from "./movies.service.js";

/*
 * Scripts: the screenplay PDF attached to a movie, one per movie. This module
 * owns script validation, the script SQL and the script response shape.
 */

/** A screenplay's length, matching the page bounds scene anchors are held to. */
const MAX_PAGE_COUNT = 300;

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

/**
 * Saving a movie's script replaces the file of the movie's one script row. The
 * page count comes from the browser, which reads the PDF before uploading it;
 * the API never parses the file.
 *
 * A different file makes every captured scene's anchors point into a document
 * that no longer exists, so replacing the PDF deletes the script's scenes and
 * their tags. Saving the same key again is the attachment retry the film-save
 * journal performs after a lost response, and keeps them.
 */
export async function saveScript(pool, movieId, body) {
    const { s3_key, page_count } = body || {};
    const trimmedKey = typeof s3_key === "string" ? s3_key.trim() : "";
    const pages = Number.isInteger(page_count) ? page_count : 0;

    if (!trimmedKey || !trimmedKey.startsWith("scripts/") || pages < 1 || pages > MAX_PAGE_COUNT) {
        throw new HttpError(400, "Invalid body. Expected { s3_key:string, page_count:int }");
    }

    await ensureMovieExists(pool, movieId);

    const row = await withTransaction(pool, async (client) => {
        const existing = await client.query("SELECT id, s3_key FROM scripts WHERE movie_id = $1 FOR UPDATE", [
            movieId,
        ]);
        const previous = existing.rows[0];
        if (previous && previous.s3_key !== trimmedKey) {
            await client.query("DELETE FROM captured_scenes WHERE script_id = $1", [previous.id]);
        }

        const result = await client.query(
            `
            INSERT INTO scripts (id, movie_id, s3_key, page_count)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (movie_id)
            DO UPDATE SET s3_key = EXCLUDED.s3_key, page_count = EXCLUDED.page_count
            RETURNING *
          `,
            [uuidv4(), movieId, trimmedKey, pages]
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
