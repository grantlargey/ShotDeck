import { v4 as uuidv4 } from "uuid";
import { HttpError } from "../utils/http-error.js";
import { ensureMovieExists } from "../repositories/annotations.repository.js";
import * as scriptsRepository from "../repositories/scripts.repository.js";
import * as scriptScenesRepository from "../repositories/script-scenes.repository.js";
import { withScriptViewUrl } from "../serializers/scripts.serializer.js";

export async function saveScript(db, movieId, body) {
    const { s3_key } = body || {};
    const trimmedKey = typeof s3_key === "string" ? s3_key.trim() : "";

    if (!trimmedKey || !trimmedKey.startsWith("scripts/")) {
        throw new HttpError(400, "Invalid body. Expected { s3_key:string }");
    }

    const movie = await ensureMovieExists(db, movieId);
    if (!movie) throw new HttpError(404, "Movie not found");

    const row = await scriptsRepository.upsertScriptForMovie(db, {
        id: uuidv4(),
        movieId,
        s3Key: trimmedKey,
    });
    return withScriptViewUrl(row);
}

export async function listScripts(db, movieId) {
    const rows = await scriptsRepository.listScriptsForMovie(db, movieId);
    return Promise.all(rows.map(withScriptViewUrl));
}

export async function getScript(db, { movieId, scriptId }) {
    const row = await scriptsRepository.findScriptForMovie(db, { movieId, scriptId });
    if (!row) throw new HttpError(404, "Script not found");
    return withScriptViewUrl(row);
}

export async function resolveSceneByTime(db, { movieId, requestedScriptId, timeSeconds }) {
    const scriptRow = requestedScriptId
        ? await scriptsRepository.findScriptForMovie(db, { movieId, scriptId: requestedScriptId })
        : await scriptsRepository.findLatestScriptForMovie(db, movieId);

    if (!scriptRow?.id) {
        return {
            found: false,
            reason: "NO_SCRIPT",
            script_id: null,
            scene_id: null,
        };
    }

    const scene = await scriptScenesRepository.findSceneByTime(db, {
        movieId,
        scriptId: scriptRow.id,
        timeSeconds,
    });

    if (!scene) {
        return {
            found: false,
            reason: "NO_SCENE_FOR_TIMESTAMP",
            script_id: scriptRow.id,
            scene_id: null,
        };
    }

    return {
        found: true,
        reason: null,
        script_id: scene.script_id,
        scene_id: scene.scene_id,
        page_start: scene.page_start,
        page_end: scene.page_end,
        start_time_seconds: scene.start_time_seconds,
        end_time_seconds: scene.end_time_seconds,
    };
}
