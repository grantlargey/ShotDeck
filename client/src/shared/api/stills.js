import { req } from "./request.js";

export function listStills(filmId) {
  return req(`/movies/${encodeURIComponent(filmId)}/annotations`);
}

/** A random handful of stills with images from across the films, each with its film's title. */
export function sampleStills() {
  return req("/stills/sample");
}

/** Attaches an uploaded image. The still-save module owns upload progress. */
export function createStill({ filmId, id, timeSeconds, imageKey }) {
  return req(`/movies/${encodeURIComponent(filmId)}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      time_seconds: timeSeconds,
      image_key: imageKey,
    }),
  });
}

export function updateStill({ filmId, stillId, timeSeconds, imageKey }) {
  return req(
    `/movies/${encodeURIComponent(filmId)}/annotations/${encodeURIComponent(stillId)}`,
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

export function deleteStill(filmId, stillId) {
  return req(
    `/movies/${encodeURIComponent(filmId)}/annotations/${encodeURIComponent(stillId)}`,
    { method: "DELETE" }
  );
}
