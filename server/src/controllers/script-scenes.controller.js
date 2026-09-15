import { pool } from "../db.js";
import * as scriptScenesService from "../services/script-scenes.service.js";

function rawTagsFromQuery(query) {
    return Array.isArray(query.tags) ? query.tags.join(",") : query.tags;
}

function matchMode(query) {
    return query.match === "any" ? "any" : "all";
}

export async function createScriptScene(req, res) {
    const row = await scriptScenesService.createScriptScene(pool, {
        movieId: req.params.movieId,
        scriptId: req.params.scriptId,
        body: req.body,
    });
    return res.status(201).json(row);
}

export async function listScriptScenes(req, res) {
    return res.json(
        await scriptScenesService.listScriptScenes(pool, {
            movieId: req.params.movieId,
            scriptId: req.params.scriptId,
        })
    );
}

export async function updateScriptScene(req, res) {
    return res.json(
        await scriptScenesService.updateScriptScene(pool, {
            movieId: req.params.movieId,
            scriptId: req.params.scriptId,
            sceneId: req.params.sceneId,
            body: req.body || {},
        })
    );
}

export async function deleteScriptScene(req, res) {
    await scriptScenesService.deleteScriptScene(pool, {
        movieId: req.params.movieId,
        scriptId: req.params.scriptId,
        sceneId: req.params.sceneId,
    });
    return res.status(204).send();
}

export async function searchScriptScenes(req, res) {
    return res.json(
        await scriptScenesService.searchScriptScenes(pool, {
            rawTags: rawTagsFromQuery(req.query),
            match: matchMode(req.query),
        })
    );
}
