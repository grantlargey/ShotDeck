import { normalizeTags } from "./normalizers.js";
import { req } from "./request.js";

export function listScriptScenes(movieId, scriptId) {
  return req(
    `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`
  );
}

/** Scene writes include script_key from the PDF loaded for capture. */
export function createScriptScene(movieId, scriptId, payload) {
  return req(
    `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function updateScriptScene(movieId, scriptId, sceneId, payload) {
  return req(
    `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function deleteScriptScene(movieId, scriptId, sceneId) {
  return req(
    `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
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
