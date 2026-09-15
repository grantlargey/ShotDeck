import { v4 as uuidv4 } from "uuid";
import { createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";
import { ensureMovieExists } from "./movies.service.js";
import * as scriptsRepository from "../repositories/scripts.repository.js";

/*
 * Scripts: the screenplay PDF attached to a movie, one per movie. This module
 * owns script validation and the script response shape.
 */

/** The script row, with a signed view URL for its PDF or null when signing fails. */
async function withScriptViewUrl(row) {
    if (!row.s3_key) return { ...row, script_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: row.s3_key });
        return { ...row, script_url: url };
    } catch (err) {
        console.error("Failed to sign script URL:", row.s3_key, err?.message);
        return { ...row, script_url: null };
    }
}

export async function saveScript(db, movieId, body) {
    const { s3_key } = body || {};
    const trimmedKey = typeof s3_key === "string" ? s3_key.trim() : "";

    if (!trimmedKey || !trimmedKey.startsWith("scripts/")) {
        throw new HttpError(400, "Invalid body. Expected { s3_key:string }");
    }

    await ensureMovieExists(db, movieId);

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
