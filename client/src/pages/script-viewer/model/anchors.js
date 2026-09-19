import { compareAnchors } from "@/entities/script-scene/model/scriptLocation.js";
import { findLineAtY } from "@/shared/lib/pdf-text/pageTextLines.js";

/*
 * Scene anchors while an admin captures a scene: placement and swapping,
 * stable keys, resolving a stored anchor against the current PDF index, and
 * the saved scenes' bars in the page margin. Anchors are PDF points at scale
 * 1 with a top-left origin.
 */

const POSITION_SCALE = 100000;

export const NO_ANCHORS = { start: null, end: null };

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function createLineAnchor(page, line) {
  return {
    page: page.pageNumber,
    line: line.index,
    top: round1(line.top),
    bottom: round1(line.bottom),
    text: line.text.slice(0, 120),
  };
}

function anchorKey(anchor) {
  return anchor ? `${anchor.page}:${anchor.line}` : "";
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
  const byIndex = page.lines[anchor.line];
  if (byIndex && Math.abs(byIndex.top - anchor.top) < 2) return byIndex;
  return findLineAtY(page, (anchor.top + anchor.bottom) / 2, Infinity);
}

function documentPosition(page, y) {
  return page * POSITION_SCALE + y;
}

/** Per-page bar segments for saved scenes, with lanes for vertically overlapping scenes. */
export function buildSceneSegmentsByPage(scenes) {
  const located = (Array.isArray(scenes) ? scenes : [])
    .map((scene) => ({
      scene,
      location: {
        start: { page: scene.script_location.start.page, y: scene.script_location.start.top },
        end: { page: scene.script_location.end.page, y: scene.script_location.end.bottom },
      },
    }))
    .sort(
      (a, b) =>
        documentPosition(a.location.start.page, a.location.start.y) -
        documentPosition(b.location.start.page, b.location.start.y)
    );

  const byPage = new Map();
  const laneEnds = [];

  for (const { scene, location } of located) {
    const startPosition = documentPosition(location.start.page, location.start.y);
    const endPosition = documentPosition(location.end.page, location.end.y);
    let lane = laneEnds.findIndex((end) => end < startPosition);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endPosition);
    } else {
      laneEnds[lane] = endPosition;
    }

    for (let page = location.start.page; page <= location.end.page; page += 1) {
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push({
        scene,
        lane,
        isStart: page === location.start.page,
        top: page === location.start.page ? location.start.y : null,
        bottom: page === location.end.page ? location.end.y : null,
      });
    }
  }

  return byPage;
}
