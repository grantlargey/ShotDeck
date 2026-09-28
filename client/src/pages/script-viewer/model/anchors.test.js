import { describe, expect, it } from "vitest";
import { projectScriptLocation } from "@/entities/script-scene/model/scriptLocation.js";
import { buildSceneSegmentsByPage } from "./anchors.js";

const page = (pageNumber, height = 800) => ({ pageNumber, width: 600, height,
  lines: [100, 120, 200, 300].map((baseline) => ({ baseline, top: baseline - 16.4, bottom: baseline + 4.8, fontSize: 20 })) });
const location = (start, end, startPage = 1, endPage = startPage) => ({
  start: { page: startPage, y: start }, end: { page: endPage, y: end },
});

describe("Script location projection", () => {
  it("uses indexed type size for both range and markers and clips page edges", () => {
    const projected = projectScriptLocation(location(100, 200), page(1));
    expect(projected.start.fontSize).toBe(20);
    expect(projected.range).toEqual({ top: 83.6, bottom: 204.8 });
    expect(projected.range.top).toBe(projected.start.top);
    expect(projected.range.bottom).toBe(projected.end.bottom);
    expect(projectScriptLocation(location(0, 800), page(1)).range).toEqual({ top: 0, bottom: 800 });
  });
  it("projects multi-page spans and incomplete drafts without off-page sentinels", () => {
    const span = location(100, 200, 1, 3);
    expect(projectScriptLocation(span, page(1)).range).toEqual({ top: 83.6, bottom: 800 });
    expect(projectScriptLocation(span, page(2, 900)).range).toEqual({ top: 0, bottom: 900 });
    expect(projectScriptLocation(span, page(3)).range).toEqual({ top: 0, bottom: 204.8 });
    expect(projectScriptLocation(span, page(4)).range).toBeNull();
    const partial = projectScriptLocation({ start: span.start }, page(1));
    expect(partial.start).not.toBeNull();
    expect(partial.range).toBeNull();
  });
  it("packs overlapping visual spans into distinct lanes and reuses freed lanes", () => {
    const scenes = [location(100, 120), location(120, 200), location(300, 300)]
      .map((script_location, id) => ({ id, script_location }));
    const segments = buildSceneSegmentsByPage(scenes, new Map([[1, page(1)]] )).get(1);
    expect(segments.map(({ lane }) => lane)).toEqual([0, 1, 0]);
    expect(segments[0].top).toBe(83.6);
  });
});
