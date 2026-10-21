import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/require-admin.js";
import * as scriptScenes from "../services/script-scenes.service.js";
import * as semanticSearch from "../services/semantic-search.service.js";

/*
 * Captured-scene HTTP handlers. The module behind them owns the rules, the SQL
 * and the response shape; a handler reads the request and picks the status.
 */

const router = Router();

const SCENES_PATH = "/movies/:filmId/scripts/:scriptId/scene-annotations";

/** Search's `tags` query: comma-separated values, and the parameter may repeat. */
function tagsFromQuery(value) {
    return [value]
        .flat()
        .filter((part) => typeof part === "string")
        .flatMap((part) => part.split(/[,\n]/))
        .map((tag) => tag.trim())
        .filter(Boolean);
}

// A saved scene is embedded for semantic search in the background, so the save never waits on Gemini.
router.post(SCENES_PATH, requireAdmin, async (req, res) => {
    const { filmId, scriptId } = req.params;
    const scene = await scriptScenes.saveScriptScene(pool, { filmId, scriptId, body: req.body });
    semanticSearch.queueSceneEmbeddings(pool, [scene.id]);
    res.status(201).json(scene);
});

router.get(SCENES_PATH, async (req, res) => {
    const { filmId, scriptId } = req.params;
    res.json(await scriptScenes.listScriptScenes(pool, { filmId, scriptId }));
});

router.put(`${SCENES_PATH}/:sceneId`, requireAdmin, async (req, res) => {
    const { filmId, scriptId, sceneId } = req.params;
    const scene = await scriptScenes.saveScriptScene(pool, { filmId, scriptId, sceneId, body: req.body });
    semanticSearch.queueSceneEmbeddings(pool, [scene.id]);
    res.json(scene);
});

router.delete(`${SCENES_PATH}/:sceneId`, requireAdmin, async (req, res) => {
    const { filmId, scriptId, sceneId } = req.params;
    await scriptScenes.deleteScriptScene(pool, { filmId, scriptId, sceneId });
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

/*
 * Semantic search. A search embeds the visitor's description and ranks the
 * indexed scenes; the index itself keeps up with saves on its own.
 */
router.get("/script-scenes/semantic/status", async (req, res) => {
    res.json(await semanticSearch.getSemanticSearchStatus(pool));
});

router.get("/script-scenes/semantic", async (req, res) => {
    res.json(
        await semanticSearch.searchScenesSemantically(pool, {
            query: req.query.q,
            limit: req.query.limit,
            tags: tagsFromQuery(req.query.tags),
            match: req.query.match === "any" ? "any" : "all",
        })
    );
});

export default router;
