import { withTransaction } from "../db.js";
import { HttpError } from "../utils/http-error.js";

/**
 * A dependent film write. Accepts a Pool; work receives a transaction client
 * and the current movie. Every writer locks movie then script, so validation
 * remains true through commit, including replacement of a script with no row yet.
 * A scene save supplies the key of the PDF it was captured from, never a fresh
 * key fetched at save time. Script identity alone survives PDF replacement.
 */
export function withFilmWrite(pool, { movieId, scriptId, scriptKey }, work) {
    return withTransaction(pool, async (client) => {
        const movie = (await client.query(
            "SELECT * FROM movies WHERE id = $1 FOR NO KEY UPDATE", [movieId]
        )).rows[0];
        if (!movie) throw new HttpError(404, "Movie not found");
        if (scriptId) {
            const script = (await client.query(
                "SELECT s3_key FROM scripts WHERE id = $1 AND movie_id = $2 FOR NO KEY UPDATE",
                [scriptId, movieId]
            )).rows[0];
            if (!script) throw new HttpError(404, "Script not found");
            if (scriptKey != null && scriptKey !== script.s3_key) {
                throw new HttpError(409, "The script PDF has changed. Reload it before saving a scene.");
            }
            if (scriptKey === null) {
                throw new HttpError(400, "Reload the script before saving a scene.");
            }
        }
        return work(client, movie);
    });
}
