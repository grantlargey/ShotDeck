import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/require-admin.js";
import * as filmsService from "../services/films.service.js";

/** Film routes. Validation, SQL and response shaping live in services/films.service.js. */
const router = Router();

router.post("/movies", requireAdmin, async (req, res) => {
    res.status(201).json(await filmsService.createFilm(pool, req.body));
});

router.get("/movies", async (req, res) => {
    res.json(await filmsService.listFilms(pool));
});

router.get("/movies/:id", async (req, res) => {
    res.json(await filmsService.getFilm(pool, req.params.id));
});

router.put("/movies/:id", requireAdmin, async (req, res) => {
    res.json(await filmsService.updateFilm(pool, req.params.id, req.body));
});

router.put("/movies/:id/cover", requireAdmin, async (req, res) => {
    res.json(await filmsService.updateFilmCover(pool, req.params.id, req.body));
});

router.delete("/movies/:id", requireAdmin, async (req, res) => {
    await filmsService.deleteFilm(pool, req.params.id);
    res.status(204).send();
});

export default router;
