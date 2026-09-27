import { req } from "./request.js";

export function listAnnotations(movieId) {
  return req(`/movies/${encodeURIComponent(movieId)}/annotations`);
}

/** A random handful of stills with images from across the films, each with its film's title. */
export function sampleStills() {
  return req("/stills/sample");
}

/** Attaches an uploaded image. The still-save module owns upload progress. */
export function createAnnotation({ movieId, id, timeSeconds, imageKey }) {
  return req(`/movies/${encodeURIComponent(movieId)}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      time_seconds: timeSeconds,
      image_key: imageKey,
    }),
  });
}

export function updateAnnotation({ movieId, annotationId, timeSeconds, imageKey }) {
  return req(
    `/movies/${encodeURIComponent(movieId)}/annotations/${encodeURIComponent(annotationId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        time_seconds: timeSeconds,
        image_key: imageKey,
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
