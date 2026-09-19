import { req } from "./request.js";
import { uploadMediaFile } from "./uploads.js";

/** Returns the movie's one script, or null when it has none. */
export function getMovieScript(movieId) {
  return req(`/movies/${encodeURIComponent(movieId)}/scripts`);
}

export function getScript(movieId, scriptId) {
  return req(`/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}`);
}

/**
 * Uploads a script PDF and saves it as the movie's script. The upload refuses
 * a file that isn't a PDF before sending anything.
 */
export async function saveScript({ movieId, file }) {
  const key = await uploadMediaFile({ movieId, type: "script", file });
  return req(`/movies/${encodeURIComponent(movieId)}/scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ s3_key: key }),
  });
}
