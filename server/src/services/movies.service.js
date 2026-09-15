import { v4 as uuidv4 } from "uuid";
import { createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";

/*
 * Movies: the films that scripts, captured scenes and stills belong to. This
 * module owns movie validation, the movie SQL and the movie response shape.
 */

const INVALID_BODY_MESSAGE =
    "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) writer:string, (optional) cinematographer:string, (optional) cover_image_key:string, (optional) links:string[] }";
const INVALID_LINKS_MESSAGE = "Invalid body. 'links' must be an array of strings.";

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

/** Links are trimmed with blanks dropped, and null clears them. */
function readLinks(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (!Array.isArray(value) || !value.every((link) => typeof link === "string")) {
        throw new HttpError(400, INVALID_LINKS_MESSAGE);
    }
    return value.map((link) => link.trim()).filter(Boolean);
}

/**
 * Reads a movie write, which has one JSON shape for create and update. Title,
 * director, year and runtime are required. An optional field is undefined when
 * the body leaves it out, so an update keeps its saved value, while null clears
 * it. Links are read last, so any other invalid field reports the general message.
 */
function readMovieBody(body) {
    const { title, director, year, runtime_minutes, writer, cinematographer, cover_image_key, links } = body ?? {};
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
        links: readLinks(links),
    };
}

/** The movie row, with a signed view URL for its cover or null when it has none or signing fails. */
async function toMovieResponse(row) {
    if (!row.cover_image_key) return { ...row, cover_image_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: row.cover_image_key });
        return { ...row, cover_image_url: url };
    } catch (err) {
        console.error("Failed to sign movie cover URL:", row.cover_image_key, err?.message);
        return { ...row, cover_image_url: null };
    }
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
    const result = await db.query(
        `
        INSERT INTO movies (id, title, director, writer, cinematographer, year, runtime_minutes, cover_image_key, links)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *
      `,
        [
            uuidv4(),
            movie.title,
            movie.director,
            movie.writer ?? null,
            movie.cinematographer ?? null,
            movie.year,
            movie.runtimeMinutes,
            movie.coverImageKey ?? null,
            JSON.stringify(movie.links ?? []),
        ]
    );
    return toMovieResponse(result.rows[0]);
}

export async function listMovies(db) {
    const result = await db.query(`SELECT * FROM movies ORDER BY created_at DESC`);
    return Promise.all(result.rows.map(toMovieResponse));
}

export async function getMovie(db, id) {
    return toMovieResponse(await findMovie(db, id));
}

/** Replaces the required fields, and each optional field the body includes. */
export async function updateMovie(db, id, body) {
    const movie = readMovieBody(body);
    const saved = await findMovie(db, id);
    const keepSaved = (value, savedValue) => (value === undefined ? savedValue : value);

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
        [
            id,
            movie.title,
            movie.director,
            keepSaved(movie.writer, saved.writer),
            keepSaved(movie.cinematographer, saved.cinematographer),
            movie.year,
            movie.runtimeMinutes,
            keepSaved(movie.coverImageKey, saved.cover_image_key),
            JSON.stringify(keepSaved(movie.links, saved.links)),
        ]
    );
    if (!result.rows[0]) throw new HttpError(404, "Movie not found");
    return toMovieResponse(result.rows[0]);
}

export async function deleteMovie(db, id) {
    const result = await db.query(`DELETE FROM movies WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw new HttpError(404, "Movie not found");
}
