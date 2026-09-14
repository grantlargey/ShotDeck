import { normalizeLinks } from "./normalizers.js";
import { req } from "./request.js";

export function listMovies() {
  return req("/movies");
}

export function getMovie(id) {
  return req(`/movies/${encodeURIComponent(id)}`);
}

export function createMovie(payload) {
  const body = { ...payload };
  if ("links" in body) body.links = normalizeLinks(body.links);

  return req("/movies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateMovie(id, payload) {
  const body = { ...payload };
  if ("links" in body) body.links = normalizeLinks(body.links);

  return req(`/movies/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteMovie(id) {
  return req(`/movies/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
