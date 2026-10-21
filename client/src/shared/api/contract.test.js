import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  req: vi.fn(),
}));

vi.mock("./request.js", () => ({ req: dependencies.req }));

import { sampleStills } from "./stills.js";
import { createFilm, deleteFilm, getFilm, listFilms, updateFilm } from "./films.js";
import {
  createScriptScene,
  deleteScriptScene,
  listScriptScenes,
  sampleScriptScenes,
  searchScriptScenes,
  searchScriptScenesSemantically,
  getSemanticSearchStatus,
  updateScriptScene,
} from "./scriptScenes.js";
import { getFilmScript, getScript, saveScript } from "./scripts.js";

const SCENE_BODY = {
  start_time_seconds: 60,
  end_time_seconds: 90,
  script_location: {
    start: { page: 1, y: 120 },
    end: { page: 2, y: 156 },
  },
  scene_text: "## INT. DINER - NIGHT",
  tags: ["tone:dread"],
};

beforeEach(() => {
  dependencies.req.mockReset();
});

describe("film endpoints", () => {
  it("uses the film collection and member paths with exact payloads", () => {
    const payload = { title: "Night Diner", director: "A. Director", runtime_minutes: 120 };

    listFilms();
    getFilm("film/1");
    createFilm(payload);
    updateFilm("film/1", payload);
    deleteFilm("film/1");

    expect(dependencies.req.mock.calls).toEqual([
      ["/movies"],
      ["/movies/film%2F1"],
      ["/movies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }],
      ["/movies/film%2F1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }],
      ["/movies/film%2F1", { method: "DELETE" }],
    ]);
  });
});

describe("script endpoints", () => {
  it("reads the film's one script from the retained plural path", () => {
    getFilmScript("film/1");
    getScript("film/1", "script/1");

    expect(dependencies.req.mock.calls).toEqual([
      ["/movies/film%2F1/scripts"],
      ["/movies/film%2F1/scripts/script%2F1"],
    ]);
  });

  it("attaches an uploaded script with the canonical key", async () => {
    await saveScript({ filmId: "film/1", key: "scripts/film-1.pdf" });
    expect(dependencies.req).toHaveBeenCalledWith("/movies/film%2F1/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_key: "scripts/film-1.pdf" }),
    });
  });
});

describe("captured-scene endpoints", () => {
  it("uses the canonical collection and member paths with exact write bodies", () => {
    listScriptScenes("film/1", "script/1");
    createScriptScene("film/1", "script/1", SCENE_BODY);
    updateScriptScene("film/1", "script/1", "scene/1", SCENE_BODY);
    deleteScriptScene("film/1", "script/1", "scene/1");

    const collection = "/movies/film%2F1/scripts/script%2F1/scene-annotations";
    expect(dependencies.req.mock.calls).toEqual([
      [collection],
      [collection, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(SCENE_BODY) }],
      [`${collection}/scene%2F1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(SCENE_BODY) }],
      [`${collection}/scene%2F1`, { method: "DELETE" }],
    ]);
  });

  it("keeps comma-separated tag encoding for search", () => {
    searchScriptScenes({ tags: [" tone:dread ", "stakes:physical"], match: "any" });

    expect(dependencies.req).toHaveBeenCalledWith(
      "/script-scenes?tags=tone%3Adread%2Cstakes%3Aphysical&match=any"
    );
  });

  it("encodes semantic queries, their tag filters, and the status check", () => {
    searchScriptScenesSemantically({
      query: "a tense diner scene",
      tags: [" tone:dread "],
      match: "any",
      limit: 8,
    });
    getSemanticSearchStatus();

    expect(dependencies.req.mock.calls).toEqual([
      ["/script-scenes/semantic?q=a+tense+diner+scene&tags=tone%3Adread&match=any&limit=8"],
      ["/script-scenes/semantic/status"],
    ]);
  });
});

describe("library sample endpoints", () => {
  it("asks for the server's own sample of stills and captured scenes", () => {
    sampleStills();
    sampleScriptScenes();

    expect(dependencies.req.mock.calls).toEqual([["/stills/sample"], ["/script-scenes/sample"]]);
  });
});
