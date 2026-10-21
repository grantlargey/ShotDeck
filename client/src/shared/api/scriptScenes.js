import { normalizeTags } from "./normalizers.js";
import { req } from "./request.js";

export function listScriptScenes(filmId, scriptId) {
  return req(
    `/movies/${encodeURIComponent(filmId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`
  );
}

/** Scene writes include script_key from the PDF loaded for capture. */
export function createScriptScene(filmId, scriptId, payload) {
  return req(
    `/movies/${encodeURIComponent(filmId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function updateScriptScene(filmId, scriptId, sceneId, payload) {
  return req(
    `/movies/${encodeURIComponent(filmId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function deleteScriptScene(filmId, scriptId, sceneId) {
  return req(
    `/movies/${encodeURIComponent(filmId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
    { method: "DELETE" }
  );
}

/** Captured scenes across every script with all of `tags`, or any of them when `match` is "any". */
export function searchScriptScenes({ tags, match }) {
  const params = new URLSearchParams();
  const tagList = normalizeTags(tags);
  if (tagList.length) params.set("tags", tagList.join(","));
  if (match === "any") params.set("match", "any");
  const qs = params.toString();
  return req(`/script-scenes${qs ? `?${qs}` : ""}`);
}

/** A random handful of captured scenes from every script, each with its film's title. */
export function sampleScriptScenes() {
  return req("/script-scenes/sample");
}

/**
 * Scenes ranked by how closely they match `query`, optionally narrowed to the
 * same tag filters. Answers `{ model, scenes }`; the API answers 503
 * until GEMINI_API_KEY is configured on the server.
 */
export function searchScriptScenesSemantically({ query, tags, match, limit }) {
  const params = new URLSearchParams({ q: query });
  const tagList = normalizeTags(tags);
  if (tagList.length) params.set("tags", tagList.join(","));
  if (match === "any") params.set("match", "any");
  if (limit) params.set("limit", String(limit));
  return req(`/script-scenes/semantic?${params.toString()}`);
}

/** Whether semantic search is configured, and how much of the scene library is indexed. */
export function getSemanticSearchStatus() {
  return req("/script-scenes/semantic/status");
}
