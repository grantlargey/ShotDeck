import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  req: vi.fn(),
  uploadMediaFile: vi.fn(),
}));

vi.mock("./request.js", () => ({ req: dependencies.req }));
vi.mock("./uploads.js", () => ({ uploadMediaFile: dependencies.uploadMediaFile }));

import { createMovie, deleteMovie, getMovie, listMovies, updateMovie } from "./movies.js";
import {
  createScriptScene,
  deleteScriptScene,
  listScriptScenes,
  searchScriptScenes,
  updateScriptScene,
} from "./scriptScenes.js";
import { getMovieScript, getScript, saveScript } from "./scripts.js";

const SCENE_BODY = {
  start_time_seconds: 60,
  end_time_seconds: 90,
  script_location: {
    start: { page: 1, line: 2, top: 10, bottom: 20, text: "INT. DINER - NIGHT" },
    end: { page: 2, line: 3, top: 30, bottom: 40, text: "CUT TO:" },
  },
  scene_text: "## INT. DINER - NIGHT",
  raw_text: "INT. DINER - NIGHT",
  tags: ["tone:dread"],
};

beforeEach(() => {
  dependencies.req.mockReset();
  dependencies.uploadMediaFile.mockReset();
});

describe("movie endpoints", () => {
  it("uses the movie collection and member paths with exact payloads", () => {
    const payload = { title: "Night Diner", director: "A. Director", runtime_minutes: 120 };

    listMovies();
    getMovie("movie/1");
    createMovie(payload);
    updateMovie("movie/1", payload);
    deleteMovie("movie/1");

    expect(dependencies.req.mock.calls).toEqual([
      ["/movies"],
      ["/movies/movie%2F1"],
      ["/movies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }],
      ["/movies/movie%2F1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }],
      ["/movies/movie%2F1", { method: "DELETE" }],
    ]);
  });
});

describe("script endpoints", () => {
  it("reads the movie's one script from the retained plural path", () => {
    getMovieScript("movie/1");
    getScript("movie/1", "script/1");

    expect(dependencies.req.mock.calls).toEqual([
      ["/movies/movie%2F1/scripts"],
      ["/movies/movie%2F1/scripts/script%2F1"],
    ]);
  });

  it("uploads and saves a script with the canonical key body", async () => {
    const file = new File(["pdf"], "script.pdf", { type: "application/pdf" });
    dependencies.uploadMediaFile.mockResolvedValue("scripts/movie-1.pdf");

    await saveScript({ movieId: "movie/1", file });

    expect(dependencies.uploadMediaFile).toHaveBeenCalledWith({ movieId: "movie/1", type: "script", file });
    expect(dependencies.req).toHaveBeenCalledWith("/movies/movie%2F1/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_key: "scripts/movie-1.pdf" }),
    });
  });
});

describe("captured-scene endpoints", () => {
  it("uses the canonical collection and member paths with exact write bodies", () => {
    listScriptScenes("movie/1", "script/1");
    createScriptScene("movie/1", "script/1", SCENE_BODY);
    updateScriptScene("movie/1", "script/1", "scene/1", SCENE_BODY);
    deleteScriptScene("movie/1", "script/1", "scene/1");

    const collection = "/movies/movie%2F1/scripts/script%2F1/scene-annotations";
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
});
