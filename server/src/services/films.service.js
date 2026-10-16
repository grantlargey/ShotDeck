import { v4 as uuidv4, validate as isUuid } from "uuid";
import { signViewUrl } from "../s3.js";
import { withFilmWrite } from "./filmWrite.js";
import { HttpError } from "../utils/http-error.js";

/*
 * Films, which scripts, captured scenes and stills belong to. This module owns
 * film validation, the film SQL and the film response shape. The table and the
 * API paths still say movies.
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
 * Reads a film write, which has one JSON shape for create and update. Title,
 * director, year and runtime are required. An optional field is undefined when
 * the body leaves it out, so an update keeps its saved value, while null clears
 * it.
 */
function readFilmBody(body) {
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
 * The film row, with a signed view URL for its cover and the moment that URL
 * stops working. Both are null when the film has no cover or its key can't be
 * signed.
 */
async function toFilmResponse(row) {
    const cover = await signViewUrl(row.cover_image_key);
    return { ...row, cover_image_url: cover.url, cover_image_url_expires_at: cover.expiresAt };
}

async function findFilm(db, id) {
    const result = await db.query(`SELECT * FROM movies WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, "Film not found");
    return result.rows[0];
}

/** Answers 404 for a write under a film that doesn't exist. Scripts and stills check their film with it. */
export async function ensureFilmExists(db, filmId) {
    const result = await db.query(`SELECT 1 FROM movies WHERE id = $1`, [filmId]);
    if (result.rowCount === 0) throw new HttpError(404, "Film not found");
}

export async function createFilm(db, body) {
    const film = readFilmBody(body);
    // The browser persists this identity before sending a recoverable film save.
    // Replaying creation must never overwrite a film that has since been edited.
    if (body.id !== undefined && !isUuid(body.id)) {
        throw new HttpError(400, "Invalid film id. Expected a UUID.");
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
            film.title,
            film.director,
            film.writer ?? null,
            film.cinematographer ?? null,
            film.year,
            film.runtimeMinutes,
            film.coverImageKey ?? null,
        ]
    );
    // A separate statement sees a concurrently committed insert after the
    // unique constraint has made the losing insert wait for it.
    return toFilmResponse(result.rows[0] ?? await findFilm(db, id));
}

export async function listFilms(db) {
    const result = await db.query(`SELECT * FROM movies ORDER BY created_at DESC`);
    return Promise.all(result.rows.map(toFilmResponse));
}

export async function getFilm(db, id) {
    return toFilmResponse(await findFilm(db, id));
}

/** A retried cover attachment must not replay previously saved film details. */
export async function updateFilmCover(db, id, body) {
    const key = body?.cover_image_key;
    if (key !== null && (typeof key !== "string" || !key.startsWith(`covers/${id}/`))) {
        throw new HttpError(400, "Invalid cover image key for this film.");
    }
    const result = await db.query(
        "UPDATE movies SET cover_image_key = $2 WHERE id = $1 RETURNING *", [id, key]
    );
    if (!result.rows[0]) throw new HttpError(404, "Film not found");
    return toFilmResponse(result.rows[0]);
}

/** Replaces the required fields, and each optional field the body includes. */
export async function updateFilm(pool, id, body) {
    const film = readFilmBody(body);
    const row = await withFilmWrite(pool, { filmId: id }, async (client, saved) => {
        if (film.runtimeMinutes < saved.runtime_minutes) {
            const outside = await client.query(
                "SELECT 1 FROM annotations WHERE movie_id = $1 AND time_seconds > $2 LIMIT 1",
                [id, (film.runtimeMinutes + 1) * 60]
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
                film.title,
                film.director,
                keepSaved(film.writer, saved.writer),
                keepSaved(film.cinematographer, saved.cinematographer),
                film.year,
                film.runtimeMinutes,
                keepSaved(film.coverImageKey, saved.cover_image_key),
            ]
        );
        if (!result.rows[0]) throw new HttpError(404, "Film not found");
        return result.rows[0];
    });
    return toFilmResponse(row);
}

export async function deleteFilm(db, id) {
    const result = await db.query(`DELETE FROM movies WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw new HttpError(404, "Film not found");
}
