import { req } from "./request.js";

/** Returns the film's one script, or null when it has none. */
export function getFilmScript(filmId) {
  return req(`/movies/${encodeURIComponent(filmId)}/scripts`);
}

export function getScript(filmId, scriptId) {
  return req(`/movies/${encodeURIComponent(filmId)}/scripts/${encodeURIComponent(scriptId)}`);
}

/**
 * Attaches an uploaded script to the film, with the page count read from the
 * PDF. Upload progress belongs to the film-save module, so attachment can be
 * retried without another upload.
 */
export async function saveScript({ filmId, key }) {
  return req(`/movies/${encodeURIComponent(filmId)}/scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ s3_key: key }),
  });
}
