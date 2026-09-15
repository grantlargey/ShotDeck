import { describe, expect, it } from "vitest";
import { anchorsFromGeometry, anchorsToGeometry, sceneScrollTarget } from "./scriptLocation.js";

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

describe("sceneScrollTarget", () => {
  it("scrolls an anchored scene to its start anchor's line", () => {
    const scene = { page_start: 2, page_end: 4, anchor_geometry: [entry("start", 3, 1), entry("end", 4, 0)] };
    expect(sceneScrollTarget(scene)).toEqual({ page: 3, offsetPt: 112 });
  });

  it("scrolls a legacy scene to the top of its first page", () => {
    expect(sceneScrollTarget({ page_start: 2, page_end: 4, anchor_geometry: [] })).toEqual({ page: 2, offsetPt: null });
  });
});
