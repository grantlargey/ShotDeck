import { api, uploadMediaFile } from "@/shared/api";

export async function createImageAnnotation({ movieId, timeSeconds, file }) {
  const imageKey = await uploadMediaFile({ movieId, type: "annotation", file });
  return api.createAnnotation(movieId, {
    time_seconds: timeSeconds,
    image_key: imageKey,
  });
}

export async function updateImageAnnotation({ movieId, annotationId, timeSeconds, imageKey, file }) {
  const nextImageKey = file
    ? await uploadMediaFile({ movieId, type: "annotation", file })
    : imageKey;

  return api.updateAnnotation(movieId, annotationId, {
    time_seconds: timeSeconds,
    image_key: nextImageKey,
  });
}

export function deleteImageAnnotation(movieId, annotationId) {
  return api.deleteAnnotation(movieId, annotationId);
}
