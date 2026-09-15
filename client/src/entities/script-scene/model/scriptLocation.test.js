import { describe, expect, it } from "vitest";
import {
  anchorsFromGeometry,
  anchorsToGeometry,
  findOverlappingScriptLocation,
  formatScenePages,
  scenePageRange,
  sceneScrollTarget,
} from "./scriptLocation.js";

/** A stored version-2 geometry entry, as the API returns it. */
function entry(kind, page, line, fields = {}) {
  return { kind, version: 2, unit: "pt", page, line, top: 100 + line * 12, bottom: 110 + line * 12, text: `line ${line}`, ...fields };
}

function anchor(page, line) {
  return { page, line, top: 100 + line * 12, bottom: 110 + line * 12, text: `line ${line}` };
}

describe("anchorsFromGeometry", () => {
  it("reads a valid version-2 start and end pair", () => {
    expect(anchorsFromGeometry([entry("start", 3, 0), entry("end", 4, 2)])).toEqual({
      start: anchor(3, 0),
      end: anchor(4, 2),
    });
  });

  it("reads the pair in either entry order, drops unknown fields, and reads missing text as empty", () => {
    const anchors = anchorsFromGeometry([entry("end", 2, 5, { extra: true }), entry("start", 2, 1, { text: undefined })]);
    expect(anchors).toEqual({ start: { ...anchor(2, 1), text: "" }, end: anchor(2, 5) });
  });

  it("takes a repeated kind's last valid entry", () => {
    const geometry = [entry("start", 1, 0), entry("end", 1, 3), entry("start", 1, 2), entry("start", "1", 9)];
    expect(anchorsFromGeometry(geometry).start).toEqual(anchor(1, 2));
  });

  it("returns null for a legacy scene: missing, empty, one-sided, wrong-version or malformed geometry", () => {
    const legacy = [
      undefined,
      null,
      "[]",
      [],
      [entry("start", 1, 0)],
      [entry("end", 1, 4)],
      [entry("start", 1, 0), entry("end", 1, 4, { version: 1 })],
      [entry("start", 1, 0), { ...entry("end", 1, 4), version: undefined }],
      [entry("start", 1, 0), entry("middle", 1, 4)],
      [entry("start", 1, 0), entry("end", "1", 4)],
      [entry("start", 1, 0), entry("end", 1, 4.5)],
      [entry("start", 1, 0), entry("end", 1, 4, { top: null })],
      [entry("start", 1, 0), entry("end", 1, 4, { bottom: Number.NaN })],
      [entry("start", 1, 0), null, "end"],
      // Client-pixel rectangles saved from DOM selections before anchors existed.
      [{ x: 10, y: 20, width: 300, height: 14, pageNumber: 1 }],
    ];
    for (const geometry of legacy) expect(anchorsFromGeometry(geometry)).toBeNull();
  });
});

describe("anchorsToGeometry", () => {
  it("writes version-2 entries in PDF points for the anchors that are placed", () => {
    expect(anchorsToGeometry({ start: anchor(3, 0), end: anchor(4, 2) })).toEqual([
      entry("start", 3, 0),
      entry("end", 4, 2),
    ]);
    expect(anchorsToGeometry({ start: null, end: anchor(4, 2) })).toEqual([entry("end", 4, 2)]);
    expect(anchorsToGeometry({ start: null, end: null })).toEqual([]);
    expect(anchorsToGeometry(null)).toEqual([]);
  });

  it("doesn't store suggestion flags, and reads back as the same anchors", () => {
    const anchors = { start: { ...anchor(1, 0), suggested: true }, end: { ...anchor(2, 5), suggested: true } };
    const geometry = anchorsToGeometry(anchors);
    expect(geometry.every((item) => !("suggested" in item))).toBe(true);
    expect(anchorsFromGeometry(geometry)).toEqual({ start: anchor(1, 0), end: anchor(2, 5) });
  });
});

describe("scenePageRange", () => {
  it("reads an inclusive range from the first page to the last", () => {
    expect(scenePageRange({ page_start: 3, page_end: 5 })).toEqual({ pageStart: 3, pageEnd: 5 });
    expect(scenePageRange({ page_start: 3, page_end: 3 })).toEqual({ pageStart: 3, pageEnd: 3 });
  });

  it("ends a range with only a start, or an unusable end, on its first page", () => {
    for (const pageEnd of [undefined, null, "", 0, -2, 4.5, "abc", 2]) {
      expect(scenePageRange({ page_start: 3, page_end: pageEnd })).toEqual({ pageStart: 3, pageEnd: 3 });
    }
  });

  it("has no range without a usable first page, even when the last page is known", () => {
    for (const pageStart of [undefined, null, "", " ", 0, -1, 1.5, "abc", true]) {
      expect(scenePageRange({ page_start: pageStart, page_end: 4 })).toBeNull();
    }
    expect(scenePageRange({})).toBeNull();
    expect(scenePageRange(null)).toBeNull();
  });

  it("reads numeric strings as page numbers", () => {
    expect(scenePageRange({ page_start: "3", page_end: "12" })).toEqual({ pageStart: 3, pageEnd: 12 });
    expect(scenePageRange({ page_start: " 7 ", page_end: null })).toEqual({ pageStart: 7, pageEnd: 7 });
  });
});

describe("formatScenePages", () => {
  it("labels one page or a range of pages", () => {
    expect(formatScenePages({ page_start: 3, page_end: 3 })).toBe("Page 3");
    expect(formatScenePages({ page_start: 3, page_end: null })).toBe("Page 3");
    expect(formatScenePages({ page_start: "3", page_end: "4" })).toBe("Pages 3–4");
  });

  it("gives unknown pages no label, instead of Page 1", () => {
    expect(formatScenePages({ page_start: null, page_end: null })).toBe("");
    expect(formatScenePages({ page_start: null, page_end: 4 })).toBe("");
    expect(formatScenePages(undefined)).toBe("");
  });
});

describe("sceneScrollTarget", () => {
  it("scrolls an anchored scene to its start anchor's line", () => {
    const scene = { page_start: 2, page_end: 4, anchor_geometry: [entry("start", 3, 1), entry("end", 4, 0)] };
    expect(sceneScrollTarget(scene)).toEqual({ page: 3, offsetPt: 112 });
    expect(sceneScrollTarget({ ...scene, page_start: null, page_end: null })).toEqual({ page: 3, offsetPt: 112 });
  });

  it("scrolls a legacy scene to the top of its first page", () => {
    expect(sceneScrollTarget({ page_start: 2, page_end: 4, anchor_geometry: [] })).toEqual({ page: 2, offsetPt: null });
    expect(sceneScrollTarget({ page_start: "5", anchor_geometry: [entry("start", 5, 0)] })).toEqual({ page: 5, offsetPt: null });
  });

  it("has no target for a legacy scene without a known page", () => {
    expect(sceneScrollTarget({ page_start: null, page_end: 4, anchor_geometry: [] })).toBeNull();
    expect(sceneScrollTarget(null)).toBeNull();
  });
});

describe("findOverlappingScriptLocation", () => {
  /** A stored scene anchored from `[page, line]` to `[page, line]`. */
  function located(id, [startPage, startLine], [endPage, endLine]) {
    return { id, page_start: startPage, page_end: endPage, anchor_geometry: [entry("start", startPage, startLine), entry("end", endPage, endLine)] };
  }

  function span([startPage, startLine], [endPage, endLine]) {
    return { start: anchor(startPage, startLine), end: anchor(endPage, endLine) };
  }

  function overlaps(other, draftAnchors) {
    return findOverlappingScriptLocation([other], draftAnchors) === other;
  }

  it("overlaps a scene that shares a boundary line, on either side", () => {
    const other = located("other", [2, 3], [2, 8]);
    expect(overlaps(other, span([2, 8], [3, 1]))).toBe(true);
    expect(overlaps(other, span([1, 20], [2, 3]))).toBe(true);
  });

  it("doesn't overlap a scene on the adjacent line, on either side", () => {
    const other = located("other", [2, 3], [2, 8]);
    expect(overlaps(other, span([2, 9], [3, 1]))).toBe(false);
    expect(overlaps(other, span([1, 20], [2, 2]))).toBe(false);
  });

  it("doesn't overlap adjacent lines on the same page even when their line boxes touch", () => {
    // Page 1's last two lines in the script viewer fixtures, at baselines 204
    // and 216: line 7's box ends below where line 8's begins.
    const lineBoxes = { 6: { top: 194.2, bottom: 206.9 }, 7: { top: 206.2, bottom: 218.9 } };
    const other = {
      id: "other",
      page_start: 1,
      page_end: 1,
      anchor_geometry: [entry("start", 1, 0), entry("end", 1, 6, lineBoxes[6])],
    };
    const draftAnchors = { start: { ...anchor(1, 7), ...lineBoxes[7] }, end: anchor(2, 3) };
    expect(findOverlappingScriptLocation([other], draftAnchors)).toBeNull();
    expect(findOverlappingScriptLocation([other], { ...draftAnchors, start: { ...anchor(1, 6), ...lineBoxes[6] } })).toBe(other);
  });

  it("doesn't overlap across a page break when one scene ends on a page's last line and the other starts the next page", () => {
    const other = located("other", [1, 0], [1, 7]);
    expect(overlaps(other, span([2, 0], [2, 3]))).toBe(false);
    expect(overlaps(other, span([1, 7], [2, 3]))).toBe(true);
  });

  it("compares ranges across pages by page first, then line", () => {
    const other = located("other", [2, 30], [4, 1]);
    // Inside the middle page, on lines numbered outside the other scene's.
    expect(overlaps(other, span([3, 0], [3, 2]))).toBe(true);
    expect(overlaps(other, span([3, 40], [3, 45]))).toBe(true);
    // Earlier lines of the first page and later lines of the last page.
    expect(overlaps(other, span([1, 40], [2, 29]))).toBe(false);
    expect(overlaps(other, span([4, 2], [5, 0]))).toBe(false);
    expect(overlaps(other, span([1, 0], [2, 30]))).toBe(true);
  });

  it("overlaps a scene that contains the anchors, or that they contain", () => {
    const other = located("other", [3, 5], [4, 10]);
    expect(overlaps(other, span([3, 6], [4, 9]))).toBe(true);
    expect(overlaps(other, span([2, 0], [5, 0]))).toBe(true);
  });

  it("overlaps a scene with identical anchors", () => {
    expect(overlaps(located("other", [3, 5], [4, 10]), span([3, 5], [4, 10]))).toBe(true);
  });

  it("treats a one-line scene as its single line", () => {
    const oneLine = located("one-line", [3, 5], [3, 5]);
    expect(overlaps(oneLine, span([3, 5], [3, 5]))).toBe(true);
    expect(overlaps(oneLine, span([3, 0], [3, 5]))).toBe(true);
    expect(overlaps(oneLine, span([3, 6], [3, 6]))).toBe(false);
    expect(overlaps(oneLine, span([3, 4], [3, 4]))).toBe(false);
    expect(overlaps(located("other", [2, 0], [4, 0]), span([3, 5], [3, 5]))).toBe(true);
  });

  it("skips a stored pair whose end comes before its start, like a legacy scene", () => {
    const reversed = { id: "reversed", page_start: 3, page_end: 4, anchor_geometry: [entry("start", 4, 0), entry("end", 3, 5)] };
    const sameLineReversed = { id: "same-page", anchor_geometry: [entry("start", 3, 9), entry("end", 3, 8)] };
    const anchored = located("anchored", [3, 9], [3, 9]);
    // Neither the lines between its anchors nor the anchors' own lines count.
    expect(findOverlappingScriptLocation([reversed, sameLineReversed], span([3, 8], [3, 9]))).toBeNull();
    expect(findOverlappingScriptLocation([reversed], span([3, 5], [4, 0]))).toBeNull();
    expect(findOverlappingScriptLocation([reversed, sameLineReversed, anchored], span([3, 8], [3, 9]))).toBe(anchored);
    // Reading the stored anchors is unchanged; only the overlap check skips them.
    expect(anchorsFromGeometry(reversed.anchor_geometry)).toEqual({ start: anchor(4, 0), end: anchor(3, 5) });
  });

  it("skips legacy scenes, even when their pages cover the anchors", () => {
    const legacy = [
      { id: "empty", page_start: 1, page_end: 9, anchor_geometry: [] },
      { id: "one-sided", page_start: 1, page_end: 9, anchor_geometry: [entry("start", 3, 5)] },
      { id: "pixels", page_start: 1, page_end: 9, anchor_geometry: [{ x: 0, y: 0, width: 400, height: 900, pageNumber: 3 }] },
      { id: "no-geometry", page_start: 3, page_end: 3 },
    ];
    const anchored = located("anchored", [3, 5], [3, 5]);
    expect(findOverlappingScriptLocation(legacy, span([3, 0], [3, 9]))).toBeNull();
    expect(findOverlappingScriptLocation([...legacy, anchored], span([3, 0], [3, 9]))).toBe(anchored);
  });

  it("excludes the scene's own row, and returns the first other overlapping scene", () => {
    const own = located("own", [3, 0], [3, 9]);
    const first = located("first", [3, 9], [4, 0]);
    const second = located("second", [2, 0], [3, 0]);
    expect(findOverlappingScriptLocation([own, first, second], span([3, 0], [3, 9]), "own")).toBe(first);
    expect(findOverlappingScriptLocation([own], span([3, 0], [3, 9]), "own")).toBeNull();
    expect(findOverlappingScriptLocation([own], span([3, 0], [3, 9]), undefined)).toBe(own);
    expect(findOverlappingScriptLocation([own], span([3, 0], [3, 9]), "")).toBe(own);
  });

  it("accepts anchors carrying extra fields, such as suggested anchors", () => {
    const suggested = { start: { ...anchor(3, 1), suggested: true }, end: { ...anchor(3, 2), suggested: true } };
    const other = located("other", [3, 2], [3, 4]);
    expect(findOverlappingScriptLocation([other], suggested)).toBe(other);
  });

  it("overlaps nothing without both anchors, or with the end before the start", () => {
    const scenes = [located("other", [1, 0], [9, 0])];
    for (const draftAnchors of [
      null,
      undefined,
      { start: null, end: null },
      { start: anchor(3, 1), end: null },
      { start: null, end: anchor(3, 1) },
      { start: anchor(3, 5), end: anchor(3, 1) },
      { start: anchor(4, 0), end: anchor(3, 9) },
    ]) {
      expect(findOverlappingScriptLocation(scenes, draftAnchors)).toBeNull();
    }
    expect(findOverlappingScriptLocation(null, span([3, 0], [3, 1]))).toBeNull();
  });
});
