import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSceneSearch } from "./HeroSceneSearch.jsx";

const api = vi.hoisted(() => ({ getSemanticSearchStatus: vi.fn() }));

vi.mock("@/shared/api/scriptScenes.js", () => ({ getSemanticSearchStatus: api.getSemanticSearchStatus }));

// The first example deals 450 ms after the page opens; each character takes 55 ms.
const typed = (characters) => 450 + 55 * characters;
const TAKE = /^Search for “(.+)”$/;

/** Script Search, as far as these tests need it: where the search landed, and what it was handed. */
function Landing() {
  const location = useLocation();
  return <output aria-label="Script Search">{`${location.pathname}${location.search} ${JSON.stringify(location.state)}`}</output>;
}

async function renderHome() {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<HeroSceneSearch />} />
        <Route path="/script-search" element={<Landing />} />
      </Routes>
    </MemoryRouter>
  );
  // Let the semantic search status arrive.
  await act(async () => {});
}

const field = () => screen.getByRole("searchbox", { name: "Describe a scene" });
const landing = () => screen.getByRole("status", { name: "Script Search" }).textContent;
const wait = (ms) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  api.getSemanticSearchStatus.mockReset();
  api.getSemanticSearchStatus.mockResolvedValue({ configured: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the home hero's search", () => {
  it("types example descriptions before anyone has touched it", async () => {
    await renderHome();
    wait(typed(4));

    expect(screen.getByRole("button", { name: TAKE })).toBeTruthy();
  });

  it("opens Script Search on what's typed, handing over where the field sat", async () => {
    await renderHome();
    act(() => field().focus());
    fireEvent.change(field(), { target: { value: "  a sudden   burst of violence " } });
    fireEvent.keyDown(field(), { key: "Enter" });

    // jsdom has no layout, so the field's box is all zeros.
    expect(landing()).toBe(
      '/script-search?q=a+sudden+burst+of+violence {"searchFrom":{"left":0,"top":0,"width":0,"height":0}}'
    );
  });

  it("searches for the example on screen from its key", async () => {
    await renderHome();
    wait(typed(6));
    const take = screen.getByRole("button", { name: TAKE });
    const example = take.getAttribute("aria-label").match(TAKE)[1];

    fireEvent.click(take);
    expect(landing()).toContain(`/script-search?${new URLSearchParams({ q: example })} `);
  });

  it("stays on the home page for an empty search", async () => {
    await renderHome();
    act(() => field().focus());
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(screen.queryByRole("status", { name: "Script Search" })).toBeNull();
    expect(field()).toBeTruthy();
  });

  it("can't be used while semantic search isn't configured", async () => {
    api.getSemanticSearchStatus.mockResolvedValue({ configured: false });
    await renderHome();
    wait(typed(4));

    expect(field().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: TAKE })).toBeNull();
  });
});
