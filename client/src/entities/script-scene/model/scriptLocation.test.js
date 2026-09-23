import { describe, expect, it } from "vitest";
import {
  compareAnchors,
  findOverlappingScriptLocation,
  formatScenePages,
  isValidScriptLocation,
  scenePageRange,
  sceneScrollTarget,
} from "./scriptLocation.js";

function anchor(page, line, fields = {}) {
  return { page, line, top: 100 + line * 12, bottom: 110 + line * 12, text: `line ${line}`, ...fields };
}

function location(start, end) {
  return { start: anchor(...start), end: anchor(...end) };
}

function scene(id, start, end) {
  return { id, script_location: location(start, end) };
}

describe("script location presentation", () => {
  it("orders anchors by page then line", () => {
    expect(compareAnchors(anchor(2, 30), anchor(3, 0))).toBeLessThan(0);
    expect(compareAnchors(anchor(3, 4), anchor(3, 5))).toBeLessThan(0);
    expect(compareAnchors(anchor(3, 5), anchor(3, 5, { top: 0 }))).toBe(0);
  });

  it("derives pages, labels and scroll target from the anchor pair", () => {
    const onePage = { script_location: location([3, 0], [3, 8]) };
    const severalPages = { script_location: location([3, 0], [5, 2]) };
    expect(scenePageRange(onePage)).toEqual({ pageStart: 3, pageEnd: 3 });
    expect(formatScenePages(onePage)).toBe("Page 3");
    expect(formatScenePages(severalPages)).toBe("Pages 3–5");
    expect(sceneScrollTarget(severalPages)).toEqual({ page: 3, offsetPt: 100 });
  });

  it("has no derived location for an incomplete unsaved draft", () => {
    for (const script_location of [null, { start: anchor(1, 0), end: null }, { start: null, end: anchor(1, 2) }]) {
      const draft = { script_location };
      expect(scenePageRange(draft)).toBeNull();
      expect(formatScenePages(draft)).toBe("");
      expect(sceneScrollTarget(draft)).toBeNull();
    }
  });

  it("validates the complete canonical anchor contract in one predicate", () => {
    expect(isValidScriptLocation(location([1, 0], [300, 100000]))).toBe(true);

    for (const invalid of [
      { start: anchor(0, 0), end: anchor(1, 1) },
      { start: anchor(1, 0), end: anchor(301, 1) },
      { start: anchor(1, 0), end: anchor(1, 100001) },
      { start: anchor(1, 0), end: anchor(1, 1, { text: null }) },
      { start: anchor(1, 0), end: anchor(1, 1, { top: Number.NaN }) },
      { start: anchor(2, 0), end: anchor(1, 1) },
    ]) {
      expect(isValidScriptLocation(invalid)).toBe(false);
    }
  });
});

describe("findOverlappingScriptLocation", () => {
  function overlaps(other, draftLocation) {
    return findOverlappingScriptLocation([other], draftLocation) === other;
  }

  it("overlaps shared boundary lines and allows adjacent lines", () => {
    const other = scene("other", [2, 3], [2, 8]);
    expect(overlaps(other, location([2, 8], [3, 1]))).toBe(true);
    expect(overlaps(other, location([1, 20], [2, 3]))).toBe(true);
    expect(overlaps(other, location([2, 9], [3, 1]))).toBe(false);
    expect(overlaps(other, location([1, 20], [2, 2]))).toBe(false);
  });

  it("compares cross-page ranges lexicographically", () => {
    const other = scene("other", [2, 30], [4, 1]);
    expect(overlaps(other, location([3, 0], [3, 2]))).toBe(true);
    expect(overlaps(other, location([3, 40], [3, 45]))).toBe(true);
    expect(overlaps(other, location([1, 40], [2, 29]))).toBe(false);
    expect(overlaps(other, location([4, 2], [5, 0]))).toBe(false);
  });

  it("handles containment, identical ranges and one-line scenes", () => {
    const other = scene("other", [3, 5], [4, 10]);
    expect(overlaps(other, location([3, 6], [4, 9]))).toBe(true);
    expect(overlaps(other, location([2, 0], [5, 0]))).toBe(true);
    expect(overlaps(other, location([3, 5], [4, 10]))).toBe(true);
    const oneLine = scene("one", [3, 5], [3, 5]);
    expect(overlaps(oneLine, location([3, 5], [3, 5]))).toBe(true);
    expect(overlaps(oneLine, location([3, 6], [3, 6]))).toBe(false);
  });

  it("excludes the draft's saved row and returns the first other overlap", () => {
    const own = scene("own", [3, 0], [3, 9]);
    const first = scene("first", [3, 9], [4, 0]);
    const second = scene("second", [2, 0], [3, 0]);
    const draft = location([3, 0], [3, 9]);
    expect(findOverlappingScriptLocation([own, first, second], draft, "own")).toBe(first);
    expect(findOverlappingScriptLocation([own], draft, "own")).toBeNull();
  });

  it("compares nothing for an incomplete or invalid unsaved location", () => {
    const scenes = [scene("other", [1, 0], [9, 0])];
    for (const draft of [
      null,
      { start: anchor(3, 1), end: null },
      { start: anchor(3, 5), end: anchor(3, 1) },
      { start: anchor(0, 0), end: anchor(1, 1) },
    ]) {
      expect(findOverlappingScriptLocation(scenes, draft)).toBeNull();
    }
  });
});
