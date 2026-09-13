import { req } from "./request.js";

export const scriptsApi = {
  listScripts: (movieId) => req(`/movies/${encodeURIComponent(movieId)}/scripts`),

  getScript: (movieId, scriptId) =>
    req(`/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}`),

  saveScript: (movieId, payload) =>
    req(`/movies/${encodeURIComponent(movieId)}/scripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
