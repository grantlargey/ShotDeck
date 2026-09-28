import { compareAnchors, projectScriptLocation } from "@/entities/script-scene/model/scriptLocation.js";
import { findLineAtY } from "@/shared/lib/pdf-text/pageTextLines.js";

/*
 * Scene anchors while an admin captures a scene: placement and swapping,
 * stable keys, resolving a stored anchor against the current PDF index, and
 * the saved scenes' bars in the page margin. An anchor is a page and the
 * baseline of a text line, in PDF points at scale 1 with a top-left origin.
 */

const POSITION_SCALE = 100000;

export const NO_ANCHORS = { start: null, end: null };

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function createLineAnchor(page, line) {
  return { page: page.pageNumber, y: round1(line.baseline) };
}

function anchorKey(anchor) {
  return anchor ? `${anchor.page}:${anchor.y}` : "";
}

export function anchorPairKey(anchors) {
  return anchors?.start && anchors?.end ? `${anchorKey(anchors.start)}-${anchorKey(anchors.end)}` : "";
}

export function hasAnyAnchor(anchors) {
  return Boolean(anchors?.start || anchors?.end);
}

/** Places one anchor, swapping the pair when the new end would precede the start. */
export function placeAnchor(anchors, kind, anchor) {
  const next = { ...anchors, [kind]: anchor };
  if (next.start && next.end && compareAnchors(next.start, next.end) > 0) {
    return { start: next.end, end: next.start };
  }
  return next;
}

/** Resolves a stored anchor to the current indexed line. */
export function resolveAnchorLine(page, anchor) {
  if (!page || !anchor) return null;
  return findLineAtY(page, anchor.y, Infinity);
}

function documentPosition(page, y) {
  return page * POSITION_SCALE + y;
}

/** Per-page bar segments for saved scenes, with lanes for vertically overlapping scenes. */
export function buildSceneSegmentsByPage(scenes, pages) {
  const located = (Array.isArray(scenes) ? scenes : [])
    .map((scene) => ({
      scene,
      location: scene.script_location,
    }))
    .sort(
      (a, b) =>
        documentPosition(a.location.start.page, a.location.start.y) -
        documentPosition(b.location.start.page, b.location.start.y)
    );

  const byPage = new Map();
  const laneEnds = [];

  for (const { scene, location } of located) {
    const startPosition = documentPosition(location.start.page,
      projectScriptLocation(location, pages.get(location.start.page)).start?.top ?? location.start.y);
    const endPosition = documentPosition(location.end.page,
      projectScriptLocation(location, pages.get(location.end.page)).end?.bottom ?? location.end.y);
    let lane = laneEnds.findIndex((end) => end < startPosition);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endPosition);
    } else {
      laneEnds[lane] = endPosition;
    }

    for (let page = location.start.page; page <= location.end.page; page += 1) {
      const projection = projectScriptLocation(location, pages.get(page));
      if (!projection.range) continue;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push({ scene, lane, isStart: page === location.start.page, ...projection.range });
    }
  }

  return byPage;
}
