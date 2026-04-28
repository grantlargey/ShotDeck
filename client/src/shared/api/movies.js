import { normalizeLinks } from "./normalizers.js";
import { req } from "./request.js";

export const moviesApi = {
  listMovies: () => req("/movies"),

  getMovie: (id) => req(`/movies/${encodeURIComponent(id)}`),

  createMovie: (payload) => {
    const body = { ...payload };
    if ("links" in body) body.links = normalizeLinks(body.links);

    return req("/movies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  updateMovie: (id, payload) => {
    const body = { ...payload };
    if ("links" in body) body.links = normalizeLinks(body.links);

    return req(`/movies/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  deleteMovie: (id) =>
    req(`/movies/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
