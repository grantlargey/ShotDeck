import { req } from "./request.js";

export function listMovies() {
  return req("/movies");
}

export function getMovie(id) {
  return req(`/movies/${encodeURIComponent(id)}`);
}

export function createMovie(payload) {
  return req("/movies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateMovie(id, payload) {
  return req(`/movies/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteMovie(id) {
  return req(`/movies/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function updateMovieCover(id, key) {
  return req(`/movies/${encodeURIComponent(id)}/cover`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cover_image_key: key }),
  });
}
