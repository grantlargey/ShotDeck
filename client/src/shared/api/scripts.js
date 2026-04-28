import { req } from "./request.js";

export const scriptsApi = {
  listScripts: (movieId) => req(`/movies/${encodeURIComponent(movieId)}/scripts`),

  getScript: (movieId, scriptId) =>
    req(`/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}`),

  findSceneByTime: (movieId, timeSeconds, options = {}) => {
    const params = new URLSearchParams();
    params.set("time", String(timeSeconds));
    if (options.scriptId) params.set("script_id", String(options.scriptId));
    return req(`/movies/${encodeURIComponent(movieId)}/scene-by-time?${params.toString()}`);
  },

  saveScript: (movieId, payload) =>
    req(`/movies/${encodeURIComponent(movieId)}/scripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
