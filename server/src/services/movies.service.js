import { v4 as uuidv4 } from "uuid";
import { HttpError } from "../utils/http-error.js";
import { normalizeLinks } from "../utils/normalize.js";
import * as moviesRepository from "../repositories/movies.repository.js";
import { withMovieCoverUrl } from "../serializers/movies.serializer.js";

function validateMoviePayload({ title, director, year, runtime_minutes }) {
    return (
        typeof title === "string" &&
        typeof director === "string" &&
        typeof year === "number" &&
        typeof runtime_minutes === "number"
    );
}

export async function createMovie(db, body) {
    const { title, director, year, runtime_minutes, cover_image_key } = body;
    const linksNorm = normalizeLinks(body.links);

    if (!validateMoviePayload(body)) {
        throw new HttpError(
            400,
            "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) cover_image_key:string, (optional) links:string[] }"
        );
    }

    if (linksNorm === "__INVALID__") {
        throw new HttpError(
            400,
            "Invalid body. 'links' must be an array of strings (or a newline-separated string)."
        );
    }

    const row = await moviesRepository.createMovie(db, {
        id: uuidv4(),
        title,
        director,
        year,
        runtimeMinutes: runtime_minutes,
        coverImageKey: cover_image_key,
        links: linksNorm === undefined ? [] : linksNorm,
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
    const linksNorm = normalizeLinks(body.links);

    if (!validateMoviePayload(body)) {
        throw new HttpError(
            400,
            "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) cover_image_key:string, (optional) links:string[] }"
        );
    }

    if (linksNorm === "__INVALID__") {
        throw new HttpError(
            400,
            "Invalid body. 'links' must be an array of strings (or a newline-separated string)."
        );
    }

    const existing = await moviesRepository.findMovieById(db, id);
    if (!existing) throw new HttpError(404, "Movie not found");

    const row = await moviesRepository.updateMovie(db, {
        id,
        title,
        director,
        year,
        runtimeMinutes: runtime_minutes,
        coverImageKey: cover_image_key === undefined ? existing.cover_image_key : cover_image_key ?? null,
        links: linksNorm === undefined ? existing.links ?? [] : linksNorm,
    });

    return withMovieCoverUrl(row);
}

export async function deleteMovie(db, id) {
    const deleted = await moviesRepository.deleteMovie(db, id);
    if (!deleted) throw new HttpError(404, "Movie not found");
}
