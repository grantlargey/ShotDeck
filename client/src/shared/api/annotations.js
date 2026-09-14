import { req } from "./request.js";
import { uploadMediaFile } from "./uploads.js";

export function listAnnotations(movieId) {
  return req(`/movies/${encodeURIComponent(movieId)}/annotations`);
}

/** Uploads a still's image, then saves the still at `timeSeconds`. */
export async function createAnnotation({ movieId, timeSeconds, file }) {
  const imageKey = await uploadMediaFile({ movieId, type: "annotation", file });
  return req(`/movies/${encodeURIComponent(movieId)}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      time_seconds: timeSeconds,
      image_key: imageKey,
    }),
  });
}

/** Saves a still's time. A `file` is uploaded first and replaces `imageKey`. */
export async function updateAnnotation({ movieId, annotationId, timeSeconds, imageKey, file }) {
  const nextImageKey = file
    ? await uploadMediaFile({ movieId, type: "annotation", file })
    : imageKey;

  return req(
    `/movies/${encodeURIComponent(movieId)}/annotations/${encodeURIComponent(annotationId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        time_seconds: timeSeconds,
        image_key: nextImageKey,
      }),
    }
  );
}

export function deleteAnnotation(movieId, annotationId) {
  return req(
    `/movies/${encodeURIComponent(movieId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: "DELETE" }
  );
}
