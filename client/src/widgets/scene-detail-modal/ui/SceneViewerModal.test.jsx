import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SceneDetailModal } from "./SceneDetailModal.jsx";
import { SceneViewerModal } from "./SceneViewerModal.jsx";

vi.mock("@/shared/api/stills.js", () => ({ listStills: vi.fn() }));
vi.mock("@/shared/api/scriptScenes.js", () => ({ listScriptScenes: vi.fn() }));

function anchor(page, line) {
  return { page, y: 96 + line * 12 };
}

function scene(id, page, text) {
  return {
    id,
    movie_id: "film-1",
    script_id: "script-1",
    script_location: { start: anchor(page, 0), end: anchor(page, 1) },
    scene_text: text,
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
        initial={{ sceneId: "scene-1" }}
        source={{ film: { id: "film-1", title: "Example film", scriptId: "script-1", scriptScenes: scenes, stills: [] } }}
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

  it("clears down to the scene's text in focused reading; Esc leaves focus, and the next closes", () => {
    const onClose = vi.fn();
    const scenes = [scene("scene-1", 1, "FIRST SCENE"), scene("scene-2", 2, "SECOND SCENE")];
    render(
      <SceneViewerModal
        initial={{ sceneId: "scene-1" }}
        source={{ film: { id: "film-1", title: "Example film", scriptId: "script-1", scriptScenes: scenes, stills: [] } }}
        onClose={onClose}
      />
    );
    const key = screen.getByRole("button", { name: "Focus" });
    expect(key.getAttribute("aria-pressed")).toBe("false");

    fireEvent.keyDown(window, { key: "f" });
    expect(key.getAttribute("aria-pressed")).toBe("true");
    // The chrome is out of reach, and the paper has the keys.
    expect(screen.getByRole("button", { name: "Close" }).closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("inert")).toBe(true);
    expect(document.activeElement.closest('[aria-label="Scene text"]')).not.toBeNull();

    // The arrow keys still step through the scenes.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("SECOND SCENE")).toBeTruthy();
    expect(key.getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(key.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("inert")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rests the focus key where there's no scene text to read", () => {
    render(
      <SceneDetailModal title="Example film" meta="Film still" focusable={false} onClose={() => {}}>
        <p>A still</p>
      </SceneDetailModal>
    );
    const key = screen.getByRole("button", { name: "Focus" });
    expect(key.disabled).toBe(true);
    fireEvent.keyDown(window, { key: "f" });
    expect(key.getAttribute("aria-pressed")).toBe("false");
  });
});
