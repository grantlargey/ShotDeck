/*
 * Script location: the required start and end scene anchors of a captured
 * scene. The HTTP contract and scene draft use the same shape:
 * `{ start: { page, line, top, bottom, text }, end: { ... } }`.
 *
 * Captured scenes of the same script can't overlap. Two locations overlap
 * when their inclusive `(page, line)` ranges share a line. Adjacent lines are
 * allowed. Stored locations are valid by contract; incomplete locations exist
 * only on unsaved drafts and return no page range or scroll target.
 */

// The bounds the API holds anchors to: a page within a screenplay's length,
// and a line within a page.
const MAX_PAGE = 300;
const MAX_LINE = 100000;

/** Orders anchors by `(page, line)`: negative when `left` comes first, zero on the same line. */
export function compareAnchors(left, right) {
  return left.page - right.page || left.line - right.line;
}

function isSceneAnchor(anchor) {
  return (
    typeof anchor === "object" &&
    anchor !== null &&
    Number.isInteger(anchor.page) &&
    anchor.page >= 1 &&
    anchor.page <= MAX_PAGE &&
    Number.isInteger(anchor.line) &&
    anchor.line >= 0 &&
    anchor.line <= MAX_LINE &&
    Number.isFinite(anchor.top) &&
    Number.isFinite(anchor.bottom) &&
    typeof anchor.text === "string"
  );
}

/** Whether a location is a complete, ordered pair accepted by the canonical HTTP contract. */
export function isValidScriptLocation(location) {
  return (
    isSceneAnchor(location?.start) &&
    isSceneAnchor(location?.end) &&
    compareAnchors(location.start, location.end) <= 0
  );
}

/** A scene's inclusive page range, or null while an unsaved draft has incomplete anchors. */
export function scenePageRange(scene) {
  const location = scene?.script_location;
  if (!isValidScriptLocation(location)) return null;
  return { pageStart: location.start.page, pageEnd: location.end.page };
}

/** "Page 3" or "Pages 3–4", or "" while an unsaved draft has incomplete anchors. */
export function formatScenePages(scene) {
  const range = scenePageRange(scene);
  if (!range) return "";
  return range.pageEnd > range.pageStart ? `Pages ${range.pageStart}–${range.pageEnd}` : `Page ${range.pageStart}`;
}

/** The stored scene's start anchor, or null for an incomplete unsaved draft. */
export function sceneScrollTarget(scene) {
  const location = scene?.script_location;
  return isValidScriptLocation(location) ? { page: location.start.page, offsetPt: location.start.top } : null;
}

/**
 * The first captured scene whose script location shares a line with
 * `location`, or null. Skips the scene with `excludeSceneId`, usually the
 * draft's own saved scene. Incomplete unsaved draft locations aren't compared.
 */
export function findOverlappingScriptLocation(scenes, location, excludeSceneId) {
  if (!isValidScriptLocation(location)) return null;

  for (const scene of Array.isArray(scenes) ? scenes : []) {
    if (excludeSceneId && scene?.id === excludeSceneId) continue;
    const other = scene.script_location;
    if (
      compareAnchors(location.start, other.end) <= 0 &&
      compareAnchors(other.start, location.end) <= 0
    ) {
      return scene;
    }
  }
  return null;
}
