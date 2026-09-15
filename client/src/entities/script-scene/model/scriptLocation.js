/*
 * Script location: where a captured scene sits in its script. A stored scene
 * says this through its page range and, when recorded, its scene anchors.
 *
 * Scene anchors mark the scene's first and last line. They are stored in the
 * scene's `anchor_geometry` as version-2 entries in PDF points (scale 1,
 * top-left origin), so they render correctly at any zoom:
 * `{ kind: "start" | "end", version: 2, unit: "pt", page, line, top, bottom, text }`.
 *
 * A legacy scene is one whose geometry has no valid version-2 start and end
 * pair, such as the client-pixel rectangles saved before anchors existed.
 * `anchorsFromGeometry` returns null for it.
 *
 * A scene's pages are known when its `page_start` is a whole page number. The
 * server orders scenes by `page_start` alone, so a `page_end` without a start
 * doesn't place a scene either. An unknown page has no default: it gets no
 * label, no page to scroll to, and sorts after every known page.
 *
 * Captured scenes of the same script can't overlap. Two script locations
 * overlap when their anchor ranges share a line: comparing `(page, line)`,
 * `a.first <= b.last && b.first <= a.last`. Scenes on adjacent lines are fine,
 * however close their lines sit on the page. Only valid anchor pairs are
 * compared, read as strictly as the server reads them, so the client never
 * refuses a save the server accepts. Reading anchors for display stays lenient
 * until legacy scenes are removed.
 */

const GEOMETRY_VERSION = 2;

/** Version-2 geometry entries for the anchors that are placed. Extra anchor fields, such as `suggested`, aren't stored. */
export function anchorsToGeometry(anchors) {
  return ["start", "end"]
    .filter((kind) => anchors?.[kind])
    .map((kind) => {
      const { page, line, top, bottom, text } = anchors[kind];
      return { kind, version: GEOMETRY_VERSION, unit: "pt", page, line, top, bottom, text };
    });
}

/**
 * A stored scene's anchors, `{ start, end }`, or null for a legacy scene. An
 * entry needs version 2, a start or end kind, a whole page and line, and a
 * finite top and bottom; when a kind repeats, its last valid entry wins. This
 * reading is lenient, for display; the overlap rule reads stored anchors
 * strictly, as the server does.
 */
export function anchorsFromGeometry(geometry) {
  const anchors = { start: null, end: null };
  for (const entry of Array.isArray(geometry) ? geometry : []) {
    if (entry?.version !== GEOMETRY_VERSION || !(entry.kind in anchors)) continue;
    if (!Number.isInteger(entry.page) || !Number.isInteger(entry.line)) continue;
    if (!Number.isFinite(entry.top) || !Number.isFinite(entry.bottom)) continue;
    anchors[entry.kind] = {
      page: entry.page,
      line: entry.line,
      top: entry.top,
      bottom: entry.bottom,
      text: String(entry.text || ""),
    };
  }
  return anchors.start && anchors.end ? anchors : null;
}

function pageNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

/**
 * A stored scene's inclusive page range, `{ pageStart, pageEnd }`, or null
 * when its pages are unknown. Pages may be numbers or numeric strings. A
 * missing, invalid or earlier `page_end` ends the range on its first page.
 */
export function scenePageRange(scene) {
  const pageStart = pageNumber(scene?.page_start);
  if (pageStart === null) return null;
  const pageEnd = pageNumber(scene?.page_end);
  return { pageStart, pageEnd: pageEnd !== null && pageEnd > pageStart ? pageEnd : pageStart };
}

/** "Page 3" or "Pages 3–4", or "" when the scene's pages are unknown. */
export function formatScenePages(scene) {
  const range = scenePageRange(scene);
  if (!range) return "";
  return range.pageEnd > range.pageStart ? `Pages ${range.pageStart}–${range.pageEnd}` : `Page ${range.pageStart}`;
}

/**
 * Where the script viewer scrolls to show a scene: its start anchor's line,
 * else the top of its first page, else null when neither is known.
 * `offsetPt` is null when only the page is known.
 */
export function sceneScrollTarget(scene) {
  const anchors = anchorsFromGeometry(scene?.anchor_geometry);
  if (anchors) return { page: anchors.start.page, offsetPt: anchors.start.top };
  const range = scenePageRange(scene);
  return range ? { page: range.pageStart, offsetPt: null } : null;
}

/** Orders scene anchors by their `(page, line)`: negative when `left` comes first, zero on the same line. */
export function compareAnchors(left, right) {
  return left.page - right.page || left.line - right.line;
}

/**
 * Whether a geometry entry is a scene anchor as the server accepts one: a start
 * or end kind, version 2, in PDF points, a whole page from 1 and a whole line
 * from 0, a finite top and bottom, and text.
 */
function isStrictSceneAnchor(entry) {
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry.kind === "start" || entry.kind === "end") &&
    entry.version === GEOMETRY_VERSION &&
    entry.unit === "pt" &&
    Number.isInteger(entry.page) &&
    entry.page >= 1 &&
    Number.isInteger(entry.line) &&
    entry.line >= 0 &&
    Number.isFinite(entry.top) &&
    Number.isFinite(entry.bottom) &&
    typeof entry.text === "string"
  );
}

/**
 * The anchor pair the overlap rule compares, or null: each kind's last strictly
 * valid entry, when both kinds have one and the start is at or before the end.
 */
function validAnchorPair(geometry) {
  const anchors = { start: null, end: null };
  for (const entry of Array.isArray(geometry) ? geometry : []) {
    if (isStrictSceneAnchor(entry)) anchors[entry.kind] = entry;
  }
  return anchors.start && anchors.end && compareAnchors(anchors.start, anchors.end) <= 0 ? anchors : null;
}

/**
 * The first captured scene whose script location shares a line with the
 * anchors `{ start, end }`, or null. Skips the scene with `excludeSceneId`,
 * usually the draft's own saved scene.
 *
 * Both sides need a valid anchor pair, by the server's rule: the anchors as
 * `anchorsToGeometry` stores them, and each other scene's stored geometry.
 * Every entry is checked strictly, so a scene is skipped when it's a legacy
 * scene, when its pair only reads leniently (no `unit`, a page below 1, a line
 * below 0, or text that isn't a string), or when its end comes before its start.
 */
export function findOverlappingScriptLocation(scenes, anchors, excludeSceneId) {
  const pair = validAnchorPair(anchorsToGeometry(anchors));
  if (!pair) return null;

  for (const scene of Array.isArray(scenes) ? scenes : []) {
    if (excludeSceneId && scene?.id === excludeSceneId) continue;
    const other = validAnchorPair(scene?.anchor_geometry);
    if (other && compareAnchors(pair.start, other.end) <= 0 && compareAnchors(other.start, pair.end) <= 0) {
      return scene;
    }
  }
  return null;
}
