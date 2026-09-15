import { findLineAtY } from "@/shared/lib/pdf-text/pageTextLines.js";

/*
 * Anchors mark the first and last line of a scene in the PDF. They are stored
 * in PDF points (scale 1, top-left origin) so they render correctly at any
 * zoom, and they are persisted in the scene's `anchor_geometry` column.
 */

const GEOMETRY_VERSION = 2;
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

function compareAnchors(left, right) {
  return left.page - right.page || left.line - right.line;
}

export function withoutSuggestions(anchors) {
  const strip = (anchor) => {
    if (!anchor) return null;
    const { suggested: _suggested, ...rest } = anchor;
    return rest;
  };
  return { start: strip(anchors?.start), end: strip(anchors?.end) };
}

/**
 * Places one anchor. If the new anchor would put the end before the start,
 * the two swap roles so a range always reads top to bottom.
 */
export function placeAnchor(anchors, kind, anchor) {
  const next = { ...withoutSuggestions(anchors), [kind]: anchor };
  if (next.start && next.end && compareAnchors(next.start, next.end) > 0) {
    return { start: next.end, end: next.start };
  }
  return next;
}

export function anchorsToGeometry(anchors) {
  const clean = withoutSuggestions(anchors);
  return ["start", "end"]
    .filter((kind) => clean[kind])
    .map((kind) => ({ kind, version: GEOMETRY_VERSION, unit: "pt", ...clean[kind] }));
}

/**
 * Reads anchors saved by this viewer. Older scenes stored client-pixel
 * rectangles from DOM selections, which cannot be re-anchored, so they return
 * null.
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
 * Finds the current line for a stored anchor: by index when the geometry still
 * matches, otherwise by nearest vertical position.
 */
export function resolveAnchorLine(page, anchor) {
  if (!page || !anchor) return null;
  const byIndex = page.lines[anchor.line];
  if (byIndex && Math.abs(byIndex.top - anchor.top) < 2) return byIndex;
  return findLineAtY(page, (anchor.top + anchor.bottom) / 2, Infinity);
}

function comparableWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ""))
    .filter((word) => word && !/^\d+[a-z]?$/.test(word));
}

function findWordRunLine(page, words, fromEnd) {
  const flat = [];
  for (const line of page.lines) {
    for (const word of comparableWords(line.text)) flat.push({ word, line });
  }

  for (let size = Math.min(6, words.length); size >= 3; size -= 1) {
    const probe = fromEnd ? words.slice(-size) : words.slice(0, size);
    let found = -1;
    for (let i = 0; i + size <= flat.length; i += 1) {
      let matches = true;
      for (let j = 0; j < size && matches; j += 1) matches = flat[i + j].word === probe[j];
      if (matches) {
        found = i;
        if (!fromEnd) break;
      }
    }
    if (found >= 0) return fromEnd ? flat[found + size - 1].line : flat[found].line;
  }
  return null;
}

/**
 * Suggests anchors for scenes saved before anchors existed by locating the
 * saved text's first and last words on its saved pages.
 */
export function suggestAnchorsFromSavedText(scene, pages) {
  const pageStart = Number(scene?.page_start || scene?.page_end);
  const pageEnd = Number(scene?.page_end || scene?.page_start);
  const startPage = pages.get(pageStart);
  const endPage = pages.get(pageEnd);
  if (!startPage || !endPage) return null;

  const words = comparableWords(scene.raw_selected_text || scene.selected_text);
  if (words.length < 3) return null;

  const startLine = findWordRunLine(startPage, words, false);
  const endLine = findWordRunLine(endPage, words, true);
  if (!startLine || !endLine) return null;

  const anchors = {
    start: { ...createLineAnchor(startPage, startLine), suggested: true },
    end: { ...createLineAnchor(endPage, endLine), suggested: true },
  };
  return compareAnchors(anchors.start, anchors.end) <= 0 ? anchors : null;
}

function documentPosition(page, y) {
  return page * POSITION_SCALE + y;
}

function sceneLocation(scene) {
  const anchors = anchorsFromGeometry(scene?.anchor_geometry);
  if (anchors) {
    return {
      approximate: false,
      start: { page: anchors.start.page, y: anchors.start.top },
      end: { page: anchors.end.page, y: anchors.end.bottom },
    };
  }

  const pageStart = Number(scene?.page_start || scene?.page_end);
  const pageEnd = Number(scene?.page_end || scene?.page_start);
  if (!Number.isInteger(pageStart) || pageStart < 1) return null;
  return {
    approximate: true,
    start: { page: pageStart, y: null },
    end: { page: Math.max(pageStart, Number.isInteger(pageEnd) ? pageEnd : pageStart), y: null },
  };
}

/**
 * Per-page bar segments for saved scenes, with lanes so overlapping scenes
 * sit side by side in the page margin. Scenes without anchors span whole
 * pages and are marked approximate.
 */
export function buildSceneSegmentsByPage(scenes) {
  const located = (Array.isArray(scenes) ? scenes : [])
    .map((scene) => ({ scene, location: sceneLocation(scene) }))
    .filter((entry) => entry.location)
    .sort(
      (a, b) =>
        documentPosition(a.location.start.page, a.location.start.y ?? 0) -
        documentPosition(b.location.start.page, b.location.start.y ?? 0)
    );

  const byPage = new Map();
  const laneEnds = [];

  for (const { scene, location } of located) {
    const startPosition = documentPosition(location.start.page, location.start.y ?? 0);
    const endPosition = documentPosition(location.end.page, location.end.y ?? POSITION_SCALE - 1);
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
        approximate: location.approximate,
        isStart: page === location.start.page,
        top: page === location.start.page ? location.start.y : null,
        bottom: page === location.end.page ? location.end.y : null,
      });
    }
  }

  return byPage;
}

export function findOverlappingSavedScene(scenes, anchors, excludeSceneId) {
  if (!anchors?.start || !anchors?.end) return null;
  const start = documentPosition(anchors.start.page, anchors.start.top);
  const end = documentPosition(anchors.end.page, anchors.end.bottom);

  for (const scene of Array.isArray(scenes) ? scenes : []) {
    if (scene.id === excludeSceneId) continue;
    const saved = anchorsFromGeometry(scene.anchor_geometry);
    if (!saved) continue;
    const savedStart = documentPosition(saved.start.page, saved.start.top);
    const savedEnd = documentPosition(saved.end.page, saved.end.bottom);
    if (start < savedEnd && savedStart < end) return scene;
  }
  return null;
}
