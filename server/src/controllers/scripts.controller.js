import { pool } from "../db.js";
import * as scriptsService from "../services/scripts.service.js";
import { isHttpError } from "../utils/http-error.js";

export async function saveScript(req, res) {
    try {
        const script = await scriptsService.saveScript(pool, req.params.id, req.body);
        return res.status(201).json(script);
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("POST /movies/:id/scripts error:", err);
        return res.status(500).json({ error: "Failed to save script" });
    }
}

export async function listScripts(req, res) {
    try {
        return res.json(await scriptsService.listScripts(pool, req.params.id));
    } catch (err) {
        console.error("GET /movies/:id/scripts error:", err);
        return res.status(500).json({ error: "Failed to fetch scripts" });
    }
}

export async function getScript(req, res) {
    try {
        return res.json(
            await scriptsService.getScript(pool, {
                movieId: req.params.movieId,
                scriptId: req.params.scriptId,
            })
        );
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("GET /movies/:movieId/scripts/:scriptId error:", err);
        return res.status(500).json({ error: "Failed to fetch script" });
    }
}

export async function resolveSceneByTime(req, res) {
    const timeSeconds = Number(req.query.time);
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
        return res
            .status(400)
            .json({ error: "Invalid time query parameter. Expected non-negative number." });
    }

    const requestedScriptId =
        typeof req.query.script_id === "string" && req.query.script_id.trim()
            ? req.query.script_id.trim()
            : null;

    try {
        return res.json(
            await scriptsService.resolveSceneByTime(pool, {
                movieId: req.params.movieId,
                requestedScriptId,
                timeSeconds,
            })
        );
    } catch (err) {
        console.error("GET /movies/:movieId/scene-by-time error:", err);
        return res.status(500).json({ error: "Failed to resolve scene by time" });
    }
}
