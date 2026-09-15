import { describe, expect, it } from "vitest";
import { getSceneScriptPath, sortScriptScenes } from "./capturedScene.js";

function scene(id, fields = {}) {
  return {
    id,
    movie_id: "m1",
    script_id: "s1",
    page_start: null,
    page_end: null,
    start_time_seconds: 0,
    end_time_seconds: 0,
    created_at: "2026-09-01T00:00:00.000Z",
    ...fields,
  };
}

function ids(rows) {
  return rows.map((row) => row.id);
}

describe("sortScriptScenes", () => {
  // The API lists a script's scenes with
  // ORDER BY COALESCE(a.page_start, 2147483647), sc.start_time_seconds, sc.created_at.

  it("orders by first page, with unknown pages last", () => {
    const rows = [
      scene("unknown", { start_time_seconds: 0 }),
      scene("p10", { page_start: 10 }),
      scene("end-only", { page_end: 1 }),
      scene("p2", { page_start: "2", page_end: 9 }),
      scene("p1", { page_start: 1, start_time_seconds: 5000 }),
    ];
    expect(ids(sortScriptScenes(rows))).toEqual(["p1", "p2", "p10", "unknown", "end-only"]);
  });

  it("breaks page ties by film timing start, then by creation time", () => {
    const rows = [
      scene("p3-late-newer", { page_start: 3, start_time_seconds: 900, created_at: "2026-09-02T10:00:00.000Z" }),
      scene("p3-early", { page_start: 3, page_end: 5, start_time_seconds: 60 }),
      scene("p3-late-older", { page_start: 3, start_time_seconds: 900, created_at: "2026-09-02T09:00:00.000Z" }),
      scene("unknown-late", { start_time_seconds: 900 }),
      scene("unknown-early", { start_time_seconds: 30 }),
    ];
    expect(ids(sortScriptScenes(rows))).toEqual([
      "p3-early",
      "p3-late-older",
      "p3-late-newer",
      "unknown-early",
      "unknown-late",
    ]);
  });

  it("keeps the given order for rows the order can't separate", () => {
    const rows = [scene("b", { page_start: 2 }), scene("a", { page_start: 2 })];
    expect(ids(sortScriptScenes(rows))).toEqual(["b", "a"]);
  });

  it("returns a new array and leaves the input alone", () => {
    const rows = [scene("p2", { page_start: 2 }), scene("p1", { page_start: 1 })];
    const sorted = sortScriptScenes(rows);
    expect(sorted).not.toBe(rows);
    expect(ids(rows)).toEqual(["p2", "p1"]);
    expect(sortScriptScenes(null)).toEqual([]);
  });
});

describe("getSceneScriptPath", () => {
  it("opens the scene on its first page when the page is known", () => {
    expect(getSceneScriptPath(scene("scene-1", { page_start: 12, page_end: 14 }))).toBe(
      "/movies/m1/scripts/s1?sceneId=scene-1&page=12"
    );
    expect(getSceneScriptPath(scene("scene-1", { page_start: "3" }))).toBe("/movies/m1/scripts/s1?sceneId=scene-1&page=3");
  });

  it("leaves the page out when it's unknown", () => {
    expect(getSceneScriptPath(scene("scene-1"))).toBe("/movies/m1/scripts/s1?sceneId=scene-1");
    expect(getSceneScriptPath(scene("scene-1", { page_end: 4 }))).toBe("/movies/m1/scripts/s1?sceneId=scene-1");
  });
});
