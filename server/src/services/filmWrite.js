import { withTransaction } from "../db.js";
import { HttpError } from "../utils/http-error.js";

/**
 * A dependent film write. Accepts a Pool; work receives a transaction client
 * and the current movie. Every writer locks movie then script, so validation
 * remains true through commit, including replacement of a script with no row yet.
 * A scene save supplies the key of the PDF it was captured from, never a fresh
 * key fetched at save time. Script identity alone survives PDF replacement.
 *
 * Naming a script obliges the caller to name a key with it. `scriptKey` is the
 * s3_key of the PDF the caller prepared its work against, or null when the
 * request carried no key at all: a key that no longer matches the script is a
 * 409, and a missing one is a 400. Both answers exist because replacing a
 * script's PDF deletes that script's captured scenes (ADR 0002, decision 5), so
 * a write let through without this check would store a captured scene whose
 * script location points into a document nobody has any more.
 *
 * An undefined key is neither of those answers: it means the calling code never
 * decided, having written `body?.script_key` without the `?? null` or left the
 * property off. That is refused here, before the transaction opens, rather than
 * read as a missing key, because the 400 tells the reader to reload the script
 * and reloading cannot fix a caller that never sends the key. Callers that name
 * no script are untouched by this: a film save, a still save, a script save and
 * a scene delete pass movieId alone and reach work with no script locked.
 */
export function withFilmWrite(pool, { movieId, scriptId, scriptKey }, work) {
    if (scriptId && scriptKey === undefined) {
        throw new Error(
            "withFilmWrite needs the scriptKey that goes with scriptId. " +
                "Pass the key the work was prepared against, or null for a request that carried none."
        );
    }
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
            // s3_key is NOT NULL, so past this point the comparison is string to
            // string: only a caller's null stands for "no key".
            if (scriptKey === null) {
                throw new HttpError(400, "Reload the script before saving a scene.");
            }
            if (scriptKey !== script.s3_key) {
                throw new HttpError(409, "The script PDF has changed. Reload it before saving a scene.");
            }
        }
        return work(client, movie);
    });
}
