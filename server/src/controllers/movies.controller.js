import { pool } from "../db.js";
import * as moviesService from "../services/movies.service.js";
import { isHttpError } from "../utils/http-error.js";

function movieFailure(message, err) {
    return {
        error:
            process.env.NODE_ENV === "production"
                ? message
                : `${message}: ${err?.message || "unknown error"}`,
    };
}

export async function createMovie(req, res) {
    try {
        const movie = await moviesService.createMovie(pool, req.body);
        return res.status(201).json(movie);
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("POST /movies error:", err);
        return res.status(500).json(movieFailure("Failed to create movie", err));
    }
}

export async function listMovies(req, res) {
    try {
        return res.json(await moviesService.listMovies(pool));
    } catch (err) {
        console.error("GET /movies error:", err);
        return res.status(500).json(movieFailure("Failed to fetch movies", err));
    }
}

export async function getMovie(req, res) {
    try {
        return res.json(await moviesService.getMovie(pool, req.params.id));
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("GET /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to fetch movie" });
    }
}

export async function updateMovie(req, res) {
    try {
        return res.json(await moviesService.updateMovie(pool, req.params.id, req.body));
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("PUT /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to update movie" });
    }
}

export async function deleteMovie(req, res) {
    try {
        await moviesService.deleteMovie(pool, req.params.id);
        return res.status(204).send();
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("DELETE /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to delete movie" });
    }
}
