export function sortAnnotationsByTime(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => a.time_seconds - b.time_seconds);
}

export function getAnnotationIndexById(annotations, annotationId) {
  if (!annotationId) return -1;
  return annotations.findIndex((row) => row.id === annotationId);
}

export function getTimelinePositionPercent(annotation, runtimeSeconds) {
  const runtime = Number(runtimeSeconds);
  if (!annotation || !Number.isFinite(runtime) || runtime <= 0) return 0;
  return Math.min(100, (Number(annotation.time_seconds || 0) / runtime) * 100);
}

export function getAnnotationImageUrl(annotation, viewUrlByKey = {}) {
  return (
    annotation?.image_url ||
    (annotation?.image_key ? viewUrlByKey[annotation.image_key] : null)
  );
}
