import { normalizeTags } from "./normalizers.js";
import { req } from "./request.js";

export function listScriptScenes(movieId, scriptId) {
  return req(
    `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`
  );
}

export function createScriptScene(movieId, scriptId, payload) {
  const body = { ...payload };
  if ("tags" in body) body.tags = normalizeTags(body.tags);

  return req(
    `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function updateScriptScene(movieId, scriptId, sceneId, payload) {
  const body = { ...payload };
  if ("tags" in body) body.tags = normalizeTags(body.tags);

  return req(
    `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
