import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/require-admin.js";
import * as moviesService from "../services/movies.service.js";

/** Movie routes. Validation, SQL and response shaping live in services/movies.service.js. */
const router = Router();

router.post("/movies", requireAdmin, async (req, res) => {
    res.status(201).json(await moviesService.createMovie(pool, req.body));
});

router.get("/movies", async (req, res) => {
    res.json(await moviesService.listMovies(pool));
});

router.get("/movies/:id", async (req, res) => {
    res.json(await moviesService.getMovie(pool, req.params.id));
});

router.put("/movies/:id", requireAdmin, async (req, res) => {
    res.json(await moviesService.updateMovie(pool, req.params.id, req.body));
});

router.put("/movies/:id/cover", requireAdmin, async (req, res) => {
    res.json(await moviesService.updateMovieCover(pool, req.params.id, req.body));
});

router.delete("/movies/:id", requireAdmin, async (req, res) => {
    await moviesService.deleteMovie(pool, req.params.id);
    res.status(204).send();
});

export default router;
