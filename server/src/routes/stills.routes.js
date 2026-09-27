import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/require-admin.js";
import * as stillsService from "../services/stills.service.js";

/**
 * Still routes. A film's still paths keep the stills' storage name, `annotations`.
 * Validation, SQL and response shaping live in services/stills.service.js.
 */
const router = Router();

router.post("/movies/:movieId/annotations", requireAdmin, async (req, res) => {
    res.status(201).json(await stillsService.createStill(pool, req.params.movieId, req.body));
});

router.get("/movies/:movieId/annotations", async (req, res) => {
    res.json(await stillsService.listStills(pool, req.params.movieId));
});

router.get("/stills/sample", async (req, res) => {
    res.json(await stillsService.sampleStills(pool));
});

router.put("/movies/:movieId/annotations/:stillId", requireAdmin, async (req, res) => {
    const { movieId, stillId } = req.params;
    res.json(await stillsService.updateStill(pool, { movieId, stillId, body: req.body }));
});

router.delete("/movies/:movieId/annotations/:stillId", requireAdmin, async (req, res) => {
    const { movieId, stillId } = req.params;
    await stillsService.deleteStill(pool, { movieId, stillId });
    res.status(204).send();
});

export default router;
