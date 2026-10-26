import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSemanticSearchStatus, searchScriptScenes, searchScriptScenesSemantically } from "@/shared/api/scriptScenes.js";
import { setFiltersFolded } from "../model/filterFold.js";
import { SceneBrowser } from "./SceneBrowser.jsx";

vi.mock("@/shared/api/scriptScenes.js", () => ({
  getSemanticSearchStatus: vi.fn(),
  searchScriptScenes: vi.fn(),
  searchScriptScenesSemantically: vi.fn(),
}));
vi.mock("@/shared/lib/usePrefersReducedMotion.js", () => ({ usePrefersReducedMotion: () => true }));

const PROTAGONIST = "character-focus:protagonist";
const SUPPORTING = "character-focus:supporting-character";
const SCENES = [
  { id: "first", script_id: "script-one", scene_text: "First scene", tags: [PROTAGONIST] },
  { id: "second", script_id: "script-one", scene_text: "Second scene", tags: [PROTAGONIST, "tone:dread"] },
  { id: "third", script_id: "script-one", scene_text: "Third scene", tags: [SUPPORTING] },
];

function Location() {
  const { search } = useLocation();
  return <output data-testid="location">{search}</output>;
}

function Browser({ scenes = SCENES, scoped = true, entry = "/?sceneId=first&page=2" }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Location />
      <SceneBrowser
        scope={scoped ? { scriptId: "script-one", scenes } : undefined}
        title={scoped ? "Scenes captured" : "Scenes"}
        instruction={scoped ? "Click a card to edit it · Double-click to expand" : undefined}
        renderScene={(scene, display) => (
          <button data-testid="scene" data-layout={display.layout}>{scene.scene_text}</button>
        )}
      />
    </MemoryRouter>
  );
}

const cards = () => screen.queryAllByTestId("scene").map((node) => node.textContent);
const field = () => screen.getByRole("searchbox", { name: "Describe a scene" });
const params = () => new URLSearchParams(screen.getByTestId("location").textContent);
const toggle = (name) => fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));

function search(text) {
  act(() => field().focus());
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  setFiltersFolded(false);
  getSemanticSearchStatus.mockResolvedValue({ configured: true });
  searchScriptScenes.mockResolvedValue(SCENES);
  searchScriptScenesSemantically.mockResolvedValue({ scenes: [] });
});

describe("script-scoped scene browsing", () => {
  it("filters this script with all/any tags, local counts and removable chips, preserving viewer parameters", async () => {
    render(<Browser />);
    fireEvent.click(screen.getByRole("button", { name: "Character Focus" }));
    expect(screen.getByRole("checkbox", { name: /Protagonist.*\(2\)/ })).toBeTruthy();
    toggle("Protagonist");
    expect(cards()).toEqual(["First scene", "Second scene"]);
    toggle("Supporting Character");
    expect(cards()).toEqual([]);
    expect(screen.getByText("No scenes match these filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Match any" }));
    expect(cards()).toEqual(["First scene", "Second scene", "Third scene"]);
    expect(params().get("match")).toBe("any");
    fireEvent.click(screen.getByRole("button", { name: "Remove Protagonist filter" }));
    expect(cards()).toEqual(["Third scene"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(cards()).toHaveLength(3);
    expect(params().get("sceneId")).toBe("first");
    expect(params().get("page")).toBe("2");
    expect(searchScriptScenes).not.toHaveBeenCalled();
    expect(searchScriptScenesSemantically).not.toHaveBeenCalled();
    await waitFor(() => expect(getSemanticSearchStatus).toHaveBeenCalledOnce());
  });

  it("updates filtered results and counts when scenes are edited, deleted or created", async () => {
    const { rerender } = render(<Browser />);
    fireEvent.click(screen.getByRole("button", { name: "Character Focus" }));
    toggle("Protagonist");
    expect(cards()).toHaveLength(2);
    const revised = [{ ...SCENES[0], tags: [SUPPORTING] }, SCENES[2]];
    rerender(<Browser scenes={revised} />);
    expect(cards()).toEqual([]);
    expect(screen.getByRole("checkbox", { name: /Protagonist.*\(0\)/ }).checked).toBe(true);
    rerender(<Browser scenes={[...revised, { ...SCENES[1], id: "new", scene_text: "New scene" }]} />);
    expect(cards()).toEqual(["New scene"]);
    expect(screen.getByRole("checkbox", { name: /Protagonist.*\(1\)/ })).toBeTruthy();
    await waitFor(() => expect(getSemanticSearchStatus).toHaveBeenCalledOnce());
  });

  it("sends script scope and filters to search, keeps ranking and renders the current saved records", async () => {
    searchScriptScenesSemantically.mockResolvedValue({ scenes: [
      { ...SCENES[1], scene_text: "Stale server text" },
      { id: "foreign", script_id: "other-script", scene_text: "Another film", tags: [PROTAGONIST] },
      SCENES[0],
    ] });
    render(<Browser entry={`/?q=harbor&tag=${PROTAGONIST}&match=any&sceneId=first`} />);
    await waitFor(() => expect(cards()).toEqual(["Second scene", "First scene"]));
    expect(searchScriptScenesSemantically).toHaveBeenCalledWith({
      query: "harbor", scriptId: "script-one", tags: [PROTAGONIST], match: "any", limit: 24,
    });
    expect(searchScriptScenes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(cards()).toEqual(["First scene", "Second scene"]);
    expect(params().get("sceneId")).toBe("first");
  });

  it("ignores an old search response and refreshes an active search after a save", async () => {
    const first = deferred();
    const second = deferred();
    searchScriptScenesSemantically.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<Browser />);
    search("first description");
    await waitFor(() => expect(searchScriptScenesSemantically).toHaveBeenCalledTimes(1));
    search("second description");
    await waitFor(() => expect(searchScriptScenesSemantically).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve({ scenes: [SCENES[1]] }));
    expect(cards()).toEqual(["Second scene"]);
    await act(async () => first.resolve({ scenes: [SCENES[0]] }));
    expect(cards()).toEqual(["Second scene"]);
    searchScriptScenesSemantically.mockResolvedValue({ scenes: [SCENES[1]] });
    rerender(<Browser scenes={[SCENES[0], { ...SCENES[1], scene_text: "Edited scene" }]} />);
    await waitFor(() => expect(searchScriptScenesSemantically).toHaveBeenCalledTimes(3));
    expect(cards()).toEqual(["Edited scene"]);
  });

  it("offers the same card and page-style toggles without changing the script selection", async () => {
    render(<Browser />);
    fireEvent.click(screen.getByRole("radio", { name: "Film still and script" }));
    expect(screen.getAllByTestId("scene").every((node) => node.dataset.layout === "split")).toBe(true);
    expect(params().get("preview")).toBe("stills");
    expect(params().get("sceneId")).toBe("first");
    const previous = document.documentElement.dataset.sceneTextStyle;
    fireEvent.click(screen.getByRole("button", { name: /^Page style:/ }));
    expect(document.documentElement.dataset.sceneTextStyle).not.toBe(previous);
    fireEvent.click(screen.getByRole("radio", { name: "Script only" }));
    expect(screen.getAllByTestId("scene").every((node) => node.dataset.layout === "script")).toBe(true);
    expect(params().has("preview")).toBe(false);
    await waitFor(() => expect(getSemanticSearchStatus).toHaveBeenCalledOnce());
  });

  it("keeps rapid URL edits together while the grid waits for its next render", async () => {
    searchScriptScenesSemantically.mockResolvedValue({ scenes: [SCENES[0]] });
    render(<Browser entry={`/?q=harbor&tag=${PROTAGONIST}&sceneId=first`} />);
    await waitFor(() => expect(cards()).toEqual(["First scene"]));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
      fireEvent.click(screen.getByRole("radio", { name: "Film still and script" }));
    });
    expect(params().has("q")).toBe(false);
    expect(params().get("preview")).toBe("stills");
    expect(params().get("sceneId")).toBe("first");
    expect(cards()).toEqual(["First scene", "Second scene"]);
    fireEvent.click(screen.getByRole("button", { name: /^Character Focus/ }));
    act(() => {
      toggle("Protagonist");
      toggle("Supporting Character");
    });
    expect(params().getAll("tag")).toEqual([SUPPORTING]);
    expect(cards()).toEqual(["Third scene"]);
  });

  it("keeps tag browsing available when description search is disabled or fails", async () => {
    getSemanticSearchStatus.mockResolvedValue({ configured: false });
    render(<Browser />);
    await waitFor(() => expect(field().disabled).toBe(true));
    expect(screen.getByText(/Description search is currently unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Character Focus" }));
    toggle("Protagonist");
    expect(cards()).toHaveLength(2);
  });

  it("shows a failed search and restores the local collection when it is cleared", async () => {
    searchScriptScenesSemantically.mockRejectedValue(new Error("Search failed."));
    render(<Browser entry="/?q=harbor" />);
    await waitFor(() => expect(screen.getByText("Search failed.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(cards()).toHaveLength(3);
    expect(screen.queryByText("Search failed.")).toBeNull();
  });
});

describe("folding the filters away", () => {
  const panel = () => screen.getByRole("complementary", { name: "Scene filters" });
  const foldButton = () => screen.getByRole("button", { name: "Fold the filters away" });

  it("swings the panel onto a spine that counts the selected tags, and brings it back", async () => {
    render(<Browser />);
    fireEvent.click(screen.getByRole("button", { name: "Character Focus" }));
    toggle("Protagonist");
    fireEvent.click(foldButton());
    expect(panel().hasAttribute("inert")).toBe(true);
    const spine = screen.getByRole("button", { name: "Show filters, 1 selected" });
    expect(spine.getAttribute("aria-expanded")).toBe("false");
    expect(spine.getAttribute("aria-controls")).toBe(panel().id);
    expect(cards()).toEqual(["First scene", "Second scene"]);
    fireEvent.click(spine);
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(screen.queryByRole("button", { name: /^Show filters/ })).toBeNull();
    expect(foldButton().getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(getSemanticSearchStatus).toHaveBeenCalledOnce());
  });

  it("remembers the folded filters for both pages", async () => {
    const { unmount } = render(<Browser />);
    fireEvent.click(foldButton());
    expect(window.localStorage.getItem("scriptdeck:scene-filters-folded")).toBe("true");
    unmount();
    render(<Browser scoped={false} />);
    expect(screen.getByRole("button", { name: "Show filters" })).toBeTruthy();
    expect(panel().hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(cards()).toHaveLength(3));
  });

  it("hands focus from the fold button to the spine and back", async () => {
    render(<Browser />);
    act(() => foldButton().focus());
    fireEvent.click(foldButton());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show filters" }));
    fireEvent.click(document.activeElement);
    expect(document.activeElement).toBe(foldButton());
    await waitFor(() => expect(getSemanticSearchStatus).toHaveBeenCalledOnce());
  });
});

describe("library scene browsing", () => {
  it("continues to load the global catalog and search without a script scope", async () => {
    render(<Browser scoped={false} />);
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(searchScriptScenes).toHaveBeenCalledWith({ tags: [], match: "all" });
    searchScriptScenesSemantically.mockResolvedValue({ scenes: [SCENES[2]] });
    search("a supporting character");
    await waitFor(() => expect(cards()).toEqual(["Third scene"]));
    expect(searchScriptScenesSemantically).toHaveBeenCalledWith({
      query: "a supporting character", tags: [], match: "all", limit: 24, scriptId: undefined,
    });
  });
});
