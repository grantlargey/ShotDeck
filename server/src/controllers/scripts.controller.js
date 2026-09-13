import { pool } from "../db.js";
import * as scriptsService from "../services/scripts.service.js";

export async function saveScript(req, res) {
    const script = await scriptsService.saveScript(pool, req.params.id, req.body);
    return res.status(201).json(script);
}

export async function listScripts(req, res) {
    return res.json(await scriptsService.listScripts(pool, req.params.id));
}

export async function getScript(req, res) {
    return res.json(
        await scriptsService.getScript(pool, {
            movieId: req.params.movieId,
            scriptId: req.params.scriptId,
        })
    );
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

    return res.json(
        await scriptsService.resolveSceneByTime(pool, {
            movieId: req.params.movieId,
            requestedScriptId,
            timeSeconds,
        })
    );
}
