import { v4 as uuidv4, validate as isUuid } from "uuid";
import { signViewUrl } from "../s3.js";
import { withFilmWrite } from "./filmWrite.js";
import { HttpError } from "../utils/http-error.js";

/*
 * Movies: the films that scripts, captured scenes and stills belong to. This
 * module owns movie validation, the movie SQL and the movie response shape.
 */

const INVALID_BODY_MESSAGE =
    "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) writer:string, (optional) cinematographer:string, (optional) cover_image_key:string }";

/** A crew credit is trimmed, and a blank one is stored as null. */
function readCredit(value) {
    if (value === undefined || value === null) return value;
    if (typeof value !== "string") throw new HttpError(400, INVALID_BODY_MESSAGE);
    return value.trim() || null;
}

function readCoverImageKey(value) {
    if (value === undefined || value === null || typeof value === "string") return value;
    throw new HttpError(400, INVALID_BODY_MESSAGE);
}

/**
 * Reads a movie write, which has one JSON shape for create and update. Title,
 * director, year and runtime are required. An optional field is undefined when
 * the body leaves it out, so an update keeps its saved value, while null clears
 * it.
 */
function readMovieBody(body) {
    const { title, director, year, runtime_minutes, writer, cinematographer, cover_image_key } = body ?? {};
    if (
        typeof title !== "string" ||
        typeof director !== "string" ||
        typeof year !== "number" ||
        typeof runtime_minutes !== "number"
    ) {
        throw new HttpError(400, INVALID_BODY_MESSAGE);
    }

    return {
        title,
        director,
        year,
        runtimeMinutes: runtime_minutes,
        writer: readCredit(writer),
        cinematographer: readCredit(cinematographer),
        coverImageKey: readCoverImageKey(cover_image_key),
    };
}

/**
 * The movie row, with a signed view URL for its cover and the moment that URL
 * stops working. Both are null when the film has no cover or its key can't be
 * signed.
 */
async function toMovieResponse(row) {
    const cover = await signViewUrl(row.cover_image_key);
    return { ...row, cover_image_url: cover.url, cover_image_url_expires_at: cover.expiresAt };
}

async function findMovie(db, id) {
    const result = await db.query(`SELECT * FROM movies WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, "Movie not found");
    return result.rows[0];
}

/** Answers 404 for a write under a movie that doesn't exist. Scripts and stills check their movie with it. */
export async function ensureMovieExists(db, movieId) {
    const result = await db.query(`SELECT 1 FROM movies WHERE id = $1`, [movieId]);
    if (result.rowCount === 0) throw new HttpError(404, "Movie not found");
}

export async function createMovie(db, body) {
    const movie = readMovieBody(body);
    // The browser persists this identity before sending a recoverable film save.
    // Replaying creation must never overwrite a film that has since been edited.
    if (body.id !== undefined && !isUuid(body.id)) {
        throw new HttpError(400, "Invalid movie id. Expected a UUID.");
    }
    const id = body.id ?? uuidv4();
    const result = await db.query(
        `
        INSERT INTO movies (id, title, director, writer, cinematographer, year, runtime_minutes, cover_image_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `,
        [
            id,
            movie.title,
            movie.director,
            movie.writer ?? null,
            movie.cinematographer ?? null,
            movie.year,
            movie.runtimeMinutes,
            movie.coverImageKey ?? null,
        ]
    );
    // A separate statement sees a concurrently committed insert after the
    // unique constraint has made the losing insert wait for it.
    return toMovieResponse(result.rows[0] ?? await findMovie(db, id));
}

export async function listMovies(db) {
    const result = await db.query(`SELECT * FROM movies ORDER BY created_at DESC`);
    return Promise.all(result.rows.map(toMovieResponse));
}

export async function getMovie(db, id) {
    return toMovieResponse(await findMovie(db, id));
}

/** A retried cover attachment must not replay previously saved film details. */
export async function updateMovieCover(db, id, body) {
    const key = body?.cover_image_key;
    if (key !== null && (typeof key !== "string" || !key.startsWith(`covers/${id}/`))) {
        throw new HttpError(400, "Invalid cover image key for this movie.");
    }
    const result = await db.query(
        "UPDATE movies SET cover_image_key = $2 WHERE id = $1 RETURNING *", [id, key]
    );
    if (!result.rows[0]) throw new HttpError(404, "Movie not found");
    return toMovieResponse(result.rows[0]);
}

/** Replaces the required fields, and each optional field the body includes. */
export async function updateMovie(pool, id, body) {
    const movie = readMovieBody(body);
    const row = await withFilmWrite(pool, { movieId: id }, async (client, saved) => {
        if (movie.runtimeMinutes < saved.runtime_minutes) {
            const outside = await client.query(
                "SELECT 1 FROM annotations WHERE movie_id = $1 AND time_seconds > $2 LIMIT 1",
                [id, (movie.runtimeMinutes + 1) * 60]
            );
            if (outside.rowCount > 0) {
                throw new HttpError(400, "The runtime would leave existing shots beyond the one-minute allowance. Update their timestamps first.");
            }
        }
        const keepSaved = (value, savedValue) => (value === undefined ? savedValue : value);

        const result = await client.query(
            `
            UPDATE movies
            SET title = $2,
                director = $3,
                writer = $4,
                cinematographer = $5,
                year = $6,
                runtime_minutes = $7,
                cover_image_key = $8
            WHERE id = $1
            RETURNING *
          `,
            [
                id,
                movie.title,
                movie.director,
                keepSaved(movie.writer, saved.writer),
                keepSaved(movie.cinematographer, saved.cinematographer),
                movie.year,
                movie.runtimeMinutes,
                keepSaved(movie.coverImageKey, saved.cover_image_key),
            ]
        );
        if (!result.rows[0]) throw new HttpError(404, "Movie not found");
        return result.rows[0];
    });
    return toMovieResponse(row);
}

export async function deleteMovie(db, id) {
    const result = await db.query(`DELETE FROM movies WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw new HttpError(404, "Movie not found");
}
