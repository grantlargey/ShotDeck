import { anchorsToGeometry } from "@/entities/script-scene/model/scriptLocation.js";
import { buildPageTextLines } from "@/shared/lib/pdf-text/pageTextLines.js";
import { estimateActionMargin } from "@/shared/lib/screenplay/layoutClassifier.js";
import { createLineAnchor } from "../model/anchors.js";

/*
 * Synthetic screenplay pages for script viewer tests. Lines are placed in PDF
 * points (US Letter, top-left origin, `y` is the baseline) at standard
 * screenplay indents, then run through the real line builder, so anchors,
 * capture and layout classification all see realistic geometry.
 */

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

const ACTION_X = 108;
const DIALOGUE_X = 180;
const PARENTHETICAL_X = 216;
const CUE_X = 252;
const TRANSITION_X = 450;

/**
 * One indexed page, built like useScriptTextIndex builds it: pdf.js-like text
 * items fed through the real buildPageTextLines.
 */
export function positionedPage(pageNumber, lines) {
  const items = lines.map(({ x, y, text, size = 12 }) => ({
    str: text,
    transform: [size, 0, 0, size, x, PAGE_HEIGHT - y],
    width: text.length * size * 0.6,
  }));
  const viewport = {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    scale: 1,
    convertToViewportPoint: (x, y) => [x, PAGE_HEIGHT - y],
  };
  return buildPageTextLines({ items }, viewport, pageNumber);
}

/**
 * A published text index. This duplicates useScriptTextIndex's publish step
 * (a new pages Map, the estimated action margin, and page offsets once
 * complete), so it can drift from the hook if that logic changes.
 */
export function textIndexFrom(pages, { total = pages.length, complete = false, doc = null } = {}) {
  const map = new Map(pages.map((page) => [page.pageNumber, page]));
  let pageOffsets = null;
  if (complete) {
    pageOffsets = new Map();
    let running = 0;
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      pageOffsets.set(pageNumber, running);
      running += map.get(pageNumber)?.textLength ?? 0;
    }
  }
  return {
    doc,
    pages: map,
    complete,
    actionMargin: estimateActionMargin([...map.values()]),
    pageOffsets,
  };
}

// p1: a scene heading, two action paragraphs, and MAYA's speech.
export const page1 = positionedPage(1, [
  { x: ACTION_X, y: 96, text: "INT. DINER - NIGHT" },
  { x: ACTION_X, y: 120, text: "Rain streaks the windows of an empty roadside diner at" },
  { x: ACTION_X, y: 132, text: "midnight. MAYA, thirties, wipes the counter in slow circles." },
  { x: ACTION_X, y: 156, text: "A bell over the door rings. SAM steps in from the storm," },
  { x: ACTION_X, y: 168, text: "shaking water from a battered canvas coat and hat." },
  { x: CUE_X, y: 192, text: "MAYA" },
  { x: DIALOGUE_X, y: 204, text: "Kitchen closed an hour ago." },
  { x: DIALOGUE_X, y: 216, text: "Coffee is all I can do." },
]);

// p2: SAM's speech with a parenthetical, an action line, and a transition.
export const page2 = positionedPage(2, [
  { x: CUE_X, y: 96, text: "SAM" },
  { x: PARENTHETICAL_X, y: 108, text: "(quietly)" },
  { x: DIALOGUE_X, y: 120, text: "Then coffee. And the booth" },
  { x: DIALOGUE_X, y: 132, text: "by the window." },
  { x: ACTION_X, y: 156, text: "Maya pours two cups and slides one across the counter." },
  { x: TRANSITION_X, y: 180, text: "CUT TO:" },
]);

// p3: a second scene heading followed by action lines.
export const page3 = positionedPage(3, [
  { x: ACTION_X, y: 96, text: "EXT. PARKING LOT - NIGHT" },
  { x: ACTION_X, y: 120, text: "Headlights sweep across the gravel as a truck pulls in slow." },
  { x: ACTION_X, y: 132, text: "Its engine ticks in the cold while the wipers keep going." },
  { x: ACTION_X, y: 156, text: "Inside the cab, a figure watches the diner window and waits." },
  { x: ACTION_X, y: 168, text: "Nobody gets out, and nobody in the diner seems to notice." },
]);

export const SCRIPT_PAGES = [page1, page2, page3];

/**
 * An extra page for the C3 variant: more long lines at a different left edge
 * than p1–p3 have at the action indent, so publishing it moves the estimated
 * action margin and changes how p1–p2 are classified.
 */
export const marginShiftPage = positionedPage(
  4,
  Array.from({ length: 12 }, (_, index) => ({
    x: 72,
    y: 96 + index * 24,
    text: `Wind pushes rain sideways across the empty highway, gust ${index + 1}.`,
  }))
);

export function lineAnchor(page, lineIndex) {
  return createLineAnchor(page, page.lines[lineIndex]);
}

export function v2Geometry(startPage, startLine, endPage, endLine) {
  return anchorsToGeometry({ start: lineAnchor(startPage, startLine), end: lineAnchor(endPage, endLine) });
}

/** A captured scene row shaped like the API serializer's response. */
export function sceneRow(fields) {
  const row = {
    id: "scene",
    anchor_id: `anchor-${fields.id ?? "scene"}`,
    movie_id: "m1",
    script_id: "s1",
    start_time_seconds: null,
    end_time_seconds: null,
    tags: [],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    page_start: null,
    page_end: null,
    selected_text: "",
    raw_selected_text: "",
    formatted_selected_text: "",
    context_prefix: null,
    context_suffix: null,
    start_offset: null,
    end_offset: null,
    anchor_geometry: [],
    first_image_annotation: null,
    ...fields,
  };
  row.anchor_geometry = Array.isArray(row.anchor_geometry) ? row.anchor_geometry : [];
  row.anchor = {
    id: row.anchor_id,
    page_start: row.page_start,
    page_end: row.page_end,
    selected_text: row.selected_text,
    raw_selected_text: row.raw_selected_text,
    formatted_selected_text: row.formatted_selected_text,
    context_prefix: row.context_prefix,
    context_suffix: row.context_suffix,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    anchor_geometry: row.anchor_geometry,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return row;
}

// Scene text saved by hand, so it differs from what p3 captures today.
export const SAVED_V2_TEXT = "## EXT. PARKING LOT - NIGHT\n\nA truck idles in the lot while someone watches the diner.";
export const SAVED_V2_RAW = "EXT. PARKING LOT - NIGHT\n\nA truck idles in the lot while someone watches the diner.";

/** A saved scene with version-2 anchors on p3 lines 1–4. */
export const savedV2Scene = sceneRow({
  id: "scene-v2",
  start_time_seconds: 600,
  end_time_seconds: 660,
  tags: ["character-focus:protagonist", "conflict-type:character-vs-self"],
  page_start: 3,
  page_end: 3,
  selected_text: SAVED_V2_TEXT,
  raw_selected_text: SAVED_V2_RAW,
  formatted_selected_text: SAVED_V2_TEXT,
  context_prefix: "stored prefix",
  context_suffix: "stored suffix",
  start_offset: 400,
  end_offset: 610,
  anchor_geometry: v2Geometry(page3, 0, page3, 3),
});

// Hard-wrapped plain text, as scenes were saved before screenplay formatting.
export const LEGACY_RAW = [
  "INT. DINER - NIGHT",
  "Rain streaks the windows of an empty roadside diner at",
  "midnight. MAYA, thirties, wipes the counter in slow circles.",
  "A bell over the door rings. SAM steps in from the storm,",
  "shaking water from a battered canvas coat and hat.",
  "MAYA",
  "Kitchen closed an hour ago.",
  "Coffee is all I can do.",
  "SAM",
  "(quietly)",
  "Then coffee. And the booth",
  "by the window.",
  "Maya pours two cups and slides one across the counter.",
  "CUT TO:",
].join("\n");

/** A legacy scene: pages 1–2, no anchors, raw text only. */
export const legacyScene = sceneRow({
  id: "scene-legacy",
  start_time_seconds: 120,
  end_time_seconds: 180,
  tags: [],
  page_start: 1,
  page_end: 2,
  selected_text: LEGACY_RAW,
  raw_selected_text: LEGACY_RAW,
  formatted_selected_text: "",
  anchor_geometry: [],
});

export const OTHER_TEXT = "### SAM\n\n> > (quietly)\n>\n> Then coffee. And the booth by the window.";

/** Another anchored scene (p2 lines 1–4), for switching drafts. */
export const otherScene = sceneRow({
  id: "scene-other",
  start_time_seconds: 300,
  end_time_seconds: 360,
  tags: ["character-focus:supporting-character"],
  page_start: 2,
  page_end: 2,
  selected_text: OTHER_TEXT,
  raw_selected_text: "SAM\n\n(quietly)\n\nThen coffee. And the booth by the window.",
  formatted_selected_text: OTHER_TEXT,
  context_prefix: "Coffee is all I can do.",
  context_suffix: "Maya pours two cups and slides one across the counter.",
  start_offset: 250,
  end_offset: 330,
  anchor_geometry: v2Geometry(page2, 0, page2, 3),
});
