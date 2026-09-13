import { v4 as uuidv4 } from "uuid";
import { HttpError } from "../utils/http-error.js";
import { normalizeLinks, normalizeOptionalText } from "../utils/normalize.js";
import * as moviesRepository from "../repositories/movies.repository.js";
import { withMovieCoverUrl } from "../serializers/movies.serializer.js";

const INVALID_BODY_MESSAGE =
    "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) writer:string, (optional) cinematographer:string, (optional) cover_image_key:string, (optional) links:string[] }";

function validateMoviePayload({ title, director, year, runtime_minutes }) {
    return (
        typeof title === "string" &&
        typeof director === "string" &&
        typeof year === "number" &&
        typeof runtime_minutes === "number"
    );
}

/**
 * Parses the optional fields shared by create and update. Undefined values mean
 * the client did not send the field, so updates keep the stored value.
 */
function normalizeOptionalFields(body) {
    const links = normalizeLinks(body.links);
    const writer = normalizeOptionalText(body.writer);
    const cinematographer = normalizeOptionalText(body.cinematographer);

    if (!validateMoviePayload(body) || writer === "__INVALID__" || cinematographer === "__INVALID__") {
        throw new HttpError(400, INVALID_BODY_MESSAGE);
    }

    if (links === "__INVALID__") {
        throw new HttpError(
            400,
            "Invalid body. 'links' must be an array of strings (or a newline-separated string)."
        );
    }

    return { links, writer, cinematographer };
}

export async function createMovie(db, body) {
    const { title, director, year, runtime_minutes, cover_image_key } = body;
    const { links, writer, cinematographer } = normalizeOptionalFields(body);

    const row = await moviesRepository.createMovie(db, {
        id: uuidv4(),
        title,
        director,
        writer: writer ?? null,
        cinematographer: cinematographer ?? null,
        year,
        runtimeMinutes: runtime_minutes,
        coverImageKey: cover_image_key,
        links: links === undefined ? [] : links,
    });

    return withMovieCoverUrl(row);
}

export async function listMovies(db) {
    const rows = await moviesRepository.listMovies(db);
    return Promise.all(rows.map(withMovieCoverUrl));
}

export async function getMovie(db, id) {
    const row = await moviesRepository.findMovieById(db, id);
    if (!row) throw new HttpError(404, "Movie not found");
    return withMovieCoverUrl(row);
}

export async function updateMovie(db, id, body) {
    const { title, director, year, runtime_minutes, cover_image_key } = body;
    const { links, writer, cinematographer } = normalizeOptionalFields(body);

    const existing = await moviesRepository.findMovieById(db, id);
    if (!existing) throw new HttpError(404, "Movie not found");

    const row = await moviesRepository.updateMovie(db, {
        id,
        title,
        director,
        writer: writer === undefined ? existing.writer : writer,
        cinematographer: cinematographer === undefined ? existing.cinematographer : cinematographer,
        year,
        runtimeMinutes: runtime_minutes,
        coverImageKey: cover_image_key === undefined ? existing.cover_image_key : cover_image_key ?? null,
        links: links === undefined ? existing.links ?? [] : links,
    });

    return withMovieCoverUrl(row);
}

export async function deleteMovie(db, id) {
    const deleted = await moviesRepository.deleteMovie(db, id);
    if (!deleted) throw new HttpError(404, "Movie not found");
}
