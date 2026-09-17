import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SceneViewerModal } from "./SceneViewerModal.jsx";

vi.mock("@/shared/api/annotations.js", () => ({ listAnnotations: vi.fn() }));
vi.mock("@/shared/api/scriptScenes.js", () => ({ listScriptScenes: vi.fn() }));

function anchor(page, line) {
  return { page, line, top: line * 12, bottom: line * 12 + 10, text: `line ${line}` };
}

function scene(id, page, text) {
  return {
    id,
    movie_id: "movie-1",
    script_id: "script-1",
    script_location: { start: anchor(page, 0), end: anchor(page, 1) },
    scene_text: text,
    raw_text: text,
    start_time_seconds: page * 60,
    end_time_seconds: page * 60 + 30,
    tags: [],
    first_image_annotation: null,
  };
}

describe("SceneViewerModal", () => {
  it("steps through its one scene list with buttons and arrow keys", () => {
    const scenes = [scene("scene-1", 1, "FIRST SCENE"), scene("scene-2", 2, "SECOND SCENE")];
    render(
      <SceneViewerModal
        initialSceneId="scene-1"
        scenes={scenes}
        stills={[]}
        movie={{ id: "movie-1", title: "Example film" }}
        scriptId="script-1"
        onClose={() => {}}
      />
    );

    expect(screen.getByText("FIRST SCENE")).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("SECOND SCENE")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("FIRST SCENE")).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });
});
