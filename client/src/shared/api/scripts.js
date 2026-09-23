import { req } from "./request.js";

/** Returns the movie's one script, or null when it has none. */
export function getMovieScript(movieId) {
  return req(`/movies/${encodeURIComponent(movieId)}/scripts`);
}

export function getScript(movieId, scriptId) {
  return req(`/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}`);
}

/**
 * Attaches an uploaded script to the film, with the page count read from the
 * PDF. Upload progress belongs to the film-save module, so attachment can be
 * retried without another upload.
 */
export async function saveScript({ movieId, key }) {
  return req(`/movies/${encodeURIComponent(movieId)}/scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ s3_key: key }),
  });
}
