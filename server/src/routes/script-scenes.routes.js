import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/require-admin.js";
import * as scriptScenes from "../services/script-scenes.service.js";

/*
 * Captured-scene HTTP handlers. The module behind them owns the rules, the SQL
 * and the response shape; a handler reads the request and picks the status.
 */

const router = Router();

const SCENES_PATH = "/movies/:movieId/scripts/:scriptId/scene-annotations";

/** Search's `tags` query: comma-separated values, and the parameter may repeat. */
function tagsFromQuery(value) {
    return [value]
        .flat()
        .filter((part) => typeof part === "string")
        .flatMap((part) => part.split(/[,\n]/))
        .map((tag) => tag.trim())
        .filter(Boolean);
}

router.post(SCENES_PATH, requireAdmin, async (req, res) => {
    const { movieId, scriptId } = req.params;
    res.status(201).json(await scriptScenes.saveScriptScene(pool, { movieId, scriptId, body: req.body }));
});

router.get(SCENES_PATH, async (req, res) => {
    const { movieId, scriptId } = req.params;
    res.json(await scriptScenes.listScriptScenes(pool, { movieId, scriptId }));
});

router.put(`${SCENES_PATH}/:sceneId`, requireAdmin, async (req, res) => {
    const { movieId, scriptId, sceneId } = req.params;
    res.json(await scriptScenes.saveScriptScene(pool, { movieId, scriptId, sceneId, body: req.body }));
});

router.delete(`${SCENES_PATH}/:sceneId`, requireAdmin, async (req, res) => {
    const { movieId, scriptId, sceneId } = req.params;
    await scriptScenes.deleteScriptScene(pool, { movieId, scriptId, sceneId });
    res.status(204).send();
});

router.get("/script-scenes", async (req, res) => {
    res.json(
        await scriptScenes.searchScriptScenes(pool, {
            tags: tagsFromQuery(req.query.tags),
            match: req.query.match === "any" ? "any" : "all",
        })
    );
});

router.get("/script-scenes/sample", async (req, res) => {
    res.json(await scriptScenes.sampleScriptScenes(pool));
});

export default router;
