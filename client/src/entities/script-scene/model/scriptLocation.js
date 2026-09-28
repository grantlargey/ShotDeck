import { findLineAtY, lineBoxAt } from "@/shared/lib/pdf-text/pageTextLines.js";

/*
 * Script location: the required start and end scene anchors of a captured
 * scene. The HTTP contract and scene draft use the same shape:
 * `{ start: { page, y }, end: { page, y } }`, where `y` is the baseline of a
 * text line in PDF points at scale 1 with a top-left origin.
 *
 * Baselines are used rather than a line's box because boxes overlap their
 * neighbours: a screenplay's leading is smaller than its ascent plus descent.
 * Baselines don't overlap, so ordering and adjacency are exact.
 *
 * Captured scenes of the same script can't overlap. Two locations overlap when
 * their inclusive `(page, y)` ranges share a point. Adjacent lines are allowed.
 * Stored locations are valid by contract; incomplete locations exist only on
 * unsaved drafts and return no page range or scroll target.
 */

// The bounds the API holds anchors to: a page within a screenplay's length,
// and a baseline within a page.
const MAX_PAGE = 300;
const MAX_Y = 1000;

/** Orders anchors by `(page, y)`: negative when `left` comes first, zero on the same line. */
export function compareAnchors(left, right) {
  return left.page - right.page || left.y - right.y;
}

function isSceneAnchor(anchor) {
  return (
    typeof anchor === "object" &&
    anchor !== null &&
    Number.isInteger(anchor.page) &&
    anchor.page >= 1 &&
    anchor.page <= MAX_PAGE &&
    Number.isFinite(anchor.y) &&
    anchor.y >= 0 &&
    anchor.y <= MAX_Y
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

/**
 * "Page 3" or "Pages 3–4", or "" while an unsaved draft has incomplete anchors.
 * These are the PDF's page numbers, which a screenplay's own numbering doesn't
 * match: title and preface pages sit in front of its page 1. They label the
 * draft an admin is capturing, beside the anchors they came from, and are kept
 * off anything a visitor reads.
 */
export function formatScenePages(scene) {
  const range = scenePageRange(scene);
  if (!range) return "";
  return range.pageEnd > range.pageStart ? `Pages ${range.pageStart}–${range.pageEnd}` : `Page ${range.pageStart}`;
}

/**
 * Where to scroll to show a stored scene: the top of its start line, not the
 * baseline, so the line is fully in view. Null for an incomplete unsaved draft.
 */
export function sceneScrollTarget(scene, pages = new Map()) {
  const location = scene?.script_location;
  if (!isValidScriptLocation(location)) return null;
  return { page: location.start.page, offsetPt: projectScriptLocation(location, pages.get(location.start.page) ?? { pageNumber: location.start.page, height: Infinity }).start.top };
}

/**
 * The first captured scene whose script location overlaps `location`, or null.
 * Skips the scene with `excludeSceneId`, usually the draft's own saved scene.
 * Incomplete unsaved draft locations aren't compared.
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


/**
 * Projects any Script location, including a draft with just one anchor, onto
 * an indexed page. All drawing and cropping share clipped point coordinates
 * and the indexed font size (12pt only while that line is unavailable).
 */
export function projectScriptLocation(location, page) {
  if (!page) return { start: null, end: null, range: null };
  const clip = (y) => Math.max(0, Math.min(page.height, y));
  const marker = (anchor) => {
    if (anchor?.page !== page.pageNumber) return null;
    const fontSize = findLineAtY(page, anchor.y, Infinity)?.fontSize ?? 12;
    const box = lineBoxAt(anchor.y, fontSize);
    return { top: clip(box.top), bottom: clip(box.bottom), fontSize };
  };
  const start = marker(location?.start);
  const end = marker(location?.end);
  const covers = isValidScriptLocation(location) &&
    page.pageNumber >= location.start.page && page.pageNumber <= location.end.page;
  return { start, end, range: covers ? { top: start?.top ?? 0, bottom: end?.bottom ?? page.height } : null };
}
