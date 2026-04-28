import { pool } from "../db.js";
import * as scriptScenesService from "../services/script-scenes.service.js";
import { isHttpError } from "../utils/http-error.js";

function rawTagsFromQuery(query) {
    return Array.isArray(query.tags) ? query.tags.join(",") : query.tags;
}

function matchMode(query) {
    return query.match === "any" ? "any" : "all";
}

function errorBody(err) {
    const body = { error: err.message };
    for (const key of Object.keys(err)) {
        if (!["name", "status"].includes(key)) body[key] = err[key];
    }
    return body;
}

export async function createScriptScene(req, res) {
    try {
        const row = await scriptScenesService.createScriptScene(pool, {
            movieId: req.params.movieId,
            scriptId: req.params.scriptId,
            body: req.body,
        });
        return res.status(201).json(row);
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json(errorBody(err));
        console.error("POST script scene annotation error:", err);
        return res.status(500).json({ error: "Failed to create script scene annotation" });
    }
}

export async function listScriptScenes(req, res) {
    try {
        return res.json(
            await scriptScenesService.listScriptScenes(pool, {
                movieId: req.params.movieId,
                scriptId: req.params.scriptId,
                rawTags: rawTagsFromQuery(req.query),
                match: matchMode(req.query),
            })
        );
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json(errorBody(err));
        console.error("GET script scene annotations error:", err);
        return res.status(500).json({ error: "Failed to fetch script scene annotations" });
    }
}

export async function updateScriptScene(req, res) {
    try {
        return res.json(
            await scriptScenesService.updateScriptScene(pool, {
                movieId: req.params.movieId,
                scriptId: req.params.scriptId,
                sceneId: req.params.sceneId,
                body: req.body || {},
            })
        );
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json(errorBody(err));
        console.error("PUT script scene annotation error:", err);
        return res.status(500).json({ error: "Failed to update script scene annotation" });
    }
}

export async function deleteScriptScene(req, res) {
    try {
        await scriptScenesService.deleteScriptScene(pool, {
            movieId: req.params.movieId,
            scriptId: req.params.scriptId,
            sceneId: req.params.sceneId,
        });
        return res.status(204).send();
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json(errorBody(err));
        console.error("DELETE script scene annotation error:", err);
        return res.status(500).json({ error: "Failed to delete script scene annotation" });
    }
}

export async function searchScriptScenes(req, res) {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(1000, rawLimit)) : 500;

    try {
        return res.json(
            await scriptScenesService.searchScriptScenes(pool, {
                rawTags: rawTagsFromQuery(req.query),
                match: matchMode(req.query),
                movieId: typeof req.query.movie_id === "string" ? req.query.movie_id : null,
                scriptId: typeof req.query.script_id === "string" ? req.query.script_id : null,
                queryText: typeof req.query.q === "string" ? req.query.q.trim() : "",
                limit,
            })
        );
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json(errorBody(err));
        console.error("GET script scene search error:", err);
        return res.status(500).json({ error: "Failed to search script scene annotations" });
    }
}
