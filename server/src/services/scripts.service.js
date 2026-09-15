import { v4 as uuidv4 } from "uuid";
import { HttpError } from "../utils/http-error.js";
import { ensureMovieExists } from "../repositories/annotations.repository.js";
import * as scriptsRepository from "../repositories/scripts.repository.js";
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
