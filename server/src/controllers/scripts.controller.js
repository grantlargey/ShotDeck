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
