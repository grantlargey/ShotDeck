import { req } from "./request.js";

export function listFilms() {
  return req("/movies");
}

export function getFilm(id) {
  return req(`/movies/${encodeURIComponent(id)}`);
}

export function createFilm(payload) {
  return req("/movies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateFilm(id, payload) {
  return req(`/movies/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteFilm(id) {
  return req(`/movies/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function updateFilmCover(id, key) {
  return req(`/movies/${encodeURIComponent(id)}/cover`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cover_image_key: key }),
  });
}
