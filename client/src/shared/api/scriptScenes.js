import { normalizeTags } from "./normalizers.js";
import { req } from "./request.js";

function appendTagFilters(params, options = {}) {
  if (options.tags) {
    const tags = normalizeTags(options.tags);
    if (tags.length) params.set("tags", tags.join(","));
  }
  if (options.match === "any") params.set("match", "any");
}

export const scriptScenesApi = {
  listScriptScenes: (movieId, scriptId, options = {}) => {
    const params = new URLSearchParams();
    appendTagFilters(params, options);
    const qs = params.toString();
    return req(
      `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations${qs ? `?${qs}` : ""}`
    );
  },

  createScriptScene: (movieId, scriptId, payload) => {
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
  },

  updateScriptScene: (movieId, scriptId, sceneId, payload) => {
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
  },

  deleteScriptScene: (movieId, scriptId, sceneId) =>
    req(
      `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
      { method: "DELETE" }
    ),

  searchScriptScenes: (options = {}) => {
    const params = new URLSearchParams();
    appendTagFilters(params, options);
    if (options.movie_id) params.set("movie_id", String(options.movie_id));
    if (options.script_id) params.set("script_id", String(options.script_id));
    if (typeof options.q === "string" && options.q.trim()) params.set("q", options.q.trim());
    const qs = params.toString();
    return req(`/script-scenes${qs ? `?${qs}` : ""}`);
  },
};
