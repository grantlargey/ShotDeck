import { describe, expect, it } from "vitest";
import { displayScriptSceneText, getSceneScriptPath, sortScriptScenes, sortScriptScenesByTime } from "./capturedScene.js";

function anchor(page, line) {
  return { page, y: 96 + line * 12 };
}

function scene(id, page = 1, line = 0, fields = {}) {
  return {
    id,
    movie_id: "m1",
    script_id: "s1",
    script_location: { start: anchor(page, line), end: anchor(page, line + 1) },
    scene_text: `scene ${id}`,
    ...fields,
  };
}

describe("displayScriptSceneText", () => {
  it("reads only the canonical scene text", () => {
    expect(displayScriptSceneText(scene("a", 1, 0, { scene_text: "## INT. DINER" }))).toBe("## INT. DINER");
    expect(displayScriptSceneText({})).toBe("");
  });

  it("does not fall back to removed text fields", () => {
    expect(
      displayScriptSceneText({
        formatted_selected_text: "## INT. LEGACY DINER",
        raw_selected_text: "INT. LEGACY DINER",
        selected_text: "INT. LEGACY DINER",
      })
    ).toBe("");
  });
});

describe("sortScriptScenes", () => {
  it("orders by start page, start baseline and id", () => {
    const rows = [scene("z", 3, 1), scene("b", 1, 4), scene("a", 1, 4), scene("first", 1, 0)];
    expect(sortScriptScenes(rows).map(({ id }) => id)).toEqual(["first", "a", "b", "z"]);
  });

  it("returns a new array and accepts a missing collection", () => {
    const rows = [scene("b", 2), scene("a", 1)];
    expect(sortScriptScenes(rows)).not.toBe(rows);
    expect(rows.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(sortScriptScenes(null)).toEqual([]);
  });
});

describe("sortScriptScenesByTime", () => {
  const timed = (id, page, line, start) =>
    scene(id, page, line, { start_time_seconds: start, end_time_seconds: start === null ? null : start + 30 });

  it("orders by the start of the film timing, not the page", () => {
    const rows = [timed("flashback", 1, 0, 3600), timed("opening", 4, 0, 60), timed("middle", 2, 0, 1800)];
    expect(sortScriptScenesByTime(rows).map(({ id }) => id)).toEqual(["opening", "middle", "flashback"]);
  });

  it("puts scenes with no timing last, in page order", () => {
    const rows = [timed("late", 1, 0, null), timed("early", 2, 0, null), timed("timed", 3, 0, 600)];
    expect(sortScriptScenesByTime(rows).map(({ id }) => id)).toEqual(["timed", "late", "early"]);
  });

  it("returns a new array and accepts a missing collection", () => {
    const rows = [timed("b", 1, 0, 90), timed("a", 2, 0, 30)];
    expect(sortScriptScenesByTime(rows)).not.toBe(rows);
    expect(rows.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(sortScriptScenesByTime(null)).toEqual([]);
  });
});

describe("getSceneScriptPath", () => {
  it("opens the scene on its start anchor's page", () => {
    expect(getSceneScriptPath(scene("scene-1", 12, 3))).toBe("/movies/m1/scripts/s1?sceneId=scene-1&page=12");
  });
});
