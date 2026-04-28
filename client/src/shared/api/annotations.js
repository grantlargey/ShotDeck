import { req } from "./request.js";

export const annotationsApi = {
  listAnnotations: (movieId) => req(`/movies/${encodeURIComponent(movieId)}/annotations`),

  createAnnotation: (movieId, payload) =>
    req(`/movies/${encodeURIComponent(movieId)}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  updateAnnotation: (movieId, annotationId, payload) =>
    req(
      `/movies/${encodeURIComponent(movieId)}/annotations/${encodeURIComponent(annotationId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    ),

  deleteAnnotation: (movieId, annotationId) =>
    req(
      `/movies/${encodeURIComponent(movieId)}/annotations/${encodeURIComponent(annotationId)}`,
      { method: "DELETE" }
    ),
};
