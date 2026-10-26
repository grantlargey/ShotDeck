import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackToScriptTile, ScriptDockTools } from "./ScriptDockTools.jsx";

const scenes = { current: { getBoundingClientRect: () => ({ top: 3000 }) } };

function Tools({ returnRef, onJumpToScenes = () => {} }) {
  return (
    <>
      <ScriptDockTools
        returnRef={returnRef}
        canEdit
        anchorMarkersVisible={false}
        sceneCount={44}
        onToggleAnchorMarkers={() => {}}
        onJumpToScenes={onJumpToScenes}
        onSearchScripts={() => {}}
      />
      <BackToScriptTile returnRef={returnRef} scenesRef={scenes} />
    </>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "scrollY", { configurable: true, value: 1200 });
  window.scrollTo = vi.fn();
});

afterEach(() => {
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

describe("the script viewer's thumb dock tools", () => {
  it("returns the reader to where the dock took them down to the scenes", () => {
    const onJumpToScenes = vi.fn();
    render(<Tools returnRef={{ current: null }} onJumpToScenes={onJumpToScenes} />);
    expect(screen.getByRole("button", { name: "Show the Begin and End marks" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Scenes/ }));
    expect(onJumpToScenes).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Back to the script" }));
    expect(window.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1200 }));
  });

  it("goes back to the script's end when the reader scrolled down to the scenes", () => {
    render(<Tools returnRef={{ current: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to the script" }));
    expect(window.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 3000 + 1200 - window.innerHeight })
    );
  });
});
