import { pool } from "../db.js";
import * as moviesService from "../services/movies.service.js";

export async function createMovie(req, res) {
    const movie = await moviesService.createMovie(pool, req.body);
    return res.status(201).json(movie);
}

export async function listMovies(req, res) {
    return res.json(await moviesService.listMovies(pool));
}

export async function getMovie(req, res) {
    return res.json(await moviesService.getMovie(pool, req.params.id));
}

export async function updateMovie(req, res) {
    return res.json(await moviesService.updateMovie(pool, req.params.id, req.body));
}

export async function deleteMovie(req, res) {
    await moviesService.deleteMovie(pool, req.params.id);
    return res.status(204).send();
}
