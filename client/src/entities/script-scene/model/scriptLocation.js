import { getScriptScenePageRange } from "./capturedScene.js";

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
 * finite top and bottom; when a kind repeats, its last valid entry wins.
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

/**
 * Where the script viewer scrolls to show a scene: its start anchor's line,
 * else the top of its first page. `offsetPt` is null when only the page is known.
 */
export function sceneScrollTarget(scene) {
  const anchors = anchorsFromGeometry(scene?.anchor_geometry);
  if (anchors) return { page: anchors.start.page, offsetPt: anchors.start.top };
  return { page: getScriptScenePageRange(scene).pageStart, offsetPt: null };
}
