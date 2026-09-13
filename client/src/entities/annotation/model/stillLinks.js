/** Project page path that opens a still in the scene viewer. */
export function getStillProjectPath(movieId, stillId) {
  const params = new URLSearchParams();
  params.set("annotationId", stillId);
  return `/movies/${movieId}?${params.toString()}`;
}
