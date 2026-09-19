import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/require-admin.js";
import * as scriptsService from "../services/scripts.service.js";

/** Script routes. Validation and response shaping live in services/scripts.service.js. */
const router = Router();

router.post("/movies/:id/scripts", requireAdmin, async (req, res) => {
    res.status(201).json(await scriptsService.saveScript(pool, req.params.id, req.body));
});

router.get("/movies/:id/scripts", async (req, res) => {
    res.json(await scriptsService.listScripts(pool, req.params.id));
});

router.get("/movies/:movieId/scripts/:scriptId", async (req, res) => {
    const { movieId, scriptId } = req.params;
    res.json(await scriptsService.getScript(pool, { movieId, scriptId }));
});

export default router;
