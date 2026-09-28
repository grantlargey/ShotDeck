import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryReel } from "./LibraryReel.jsx";

/*
 * The home page's library reel. Only the two sample requests are doubled; the
 * strips, their links and the screenplay previews are real.
 */

const api = vi.hoisted(() => ({
  sampleStills: vi.fn(),
  sampleScriptScenes: vi.fn(),
  getViewUrlForKey: vi.fn(),
}));

vi.mock("@/shared/api/stills.js", () => ({ sampleStills: api.sampleStills }));
vi.mock("@/shared/api/scriptScenes.js", () => ({ sampleScriptScenes: api.sampleScriptScenes }));
vi.mock("@/shared/api/uploads.js", () => ({ getViewUrlForKey: api.getViewUrlForKey }));

const SECTION = { name: "From the library" };

function still(n) {
  return {
    id: `a${n}`,
    movie_id: "m1",
    time_seconds: 60 * n,
    image_key: `stills/a${n}.jpg`,
    image_url: `https://media.test/a${n}.jpg`,
    thumb_key: null,
    thumb_url: null,
    movie_title: "Night Diner",
  };
}

const SCENE = {
  id: "c1",
  script_id: "s1",
  movie_id: "m2",
  start_time_seconds: 60,
  end_time_seconds: 90,
  script_location: { start: { page: 3, y: 120 }, end: { page: 4, y: 156 } },
  scene_text: "## INT. DINER - NIGHT",
  tags: [],
  first_image_annotation: null,
  movie_title: "Harbor Lights",
};

/** A promise the test settles itself. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderReel() {
  return render(
    <MemoryRouter>
      <LibraryReel />
    </MemoryRouter>
  );
}

function section() {
  return screen.getByRole("region", SECTION);
}

beforeEach(() => {
  api.sampleStills.mockReset();
  api.sampleScriptScenes.mockReset();
  api.getViewUrlForKey.mockReset();
});

describe("the library reel", () => {
  it("stays busy until both samples load, then links each still and scene to where it opens", async () => {
    const stills = deferred();
    const scenes = deferred();
    api.sampleStills.mockReturnValue(stills.promise);
    api.sampleScriptScenes.mockReturnValue(scenes.promise);
    renderReel();

    expect(section().getAttribute("aria-busy")).toBe("true");
    await act(async () => stills.resolve([still(1)]));
    expect(section().getAttribute("aria-busy")).toBe("true");
    expect(within(section()).queryAllByRole("link")).toEqual([]);

    await act(async () => scenes.resolve([SCENE]));
    expect(section().getAttribute("aria-busy")).toBe("false");
    const stillLink = within(section()).getAllByRole("link", { name: "Night Diner, still at 00:01:00" })[0];
    expect(stillLink.getAttribute("href")).toBe("/movies/m1?annotationId=a1");
    const sceneLink = within(section()).getAllByRole("link", { name: /^Harbor Lights, scene at / })[0];
    expect(sceneLink.getAttribute("href")).toBe("/movies/m2/scripts/s1?sceneId=c1&page=3");
  });

  it("keeps each strip's loop copy away from screen readers and the Tab key, but clickable", async () => {
    api.sampleStills.mockResolvedValue([still(1)]);
    api.sampleScriptScenes.mockResolvedValue([SCENE]);
    const { container } = renderReel();
    await waitFor(() => expect(section().getAttribute("aria-busy")).toBe("false"));

    const copies = container.querySelectorAll('ul[aria-hidden="true"]');
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.closest("[inert]")).toBeNull();
      for (const link of copy.querySelectorAll("a")) expect(link.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("splits ten or more stills into two strips", async () => {
    api.sampleStills.mockResolvedValue(Array.from({ length: 10 }, (_, n) => still(n + 1)));
    api.sampleScriptScenes.mockResolvedValue([]);
    renderReel();
    await waitFor(() => expect(section().getAttribute("aria-busy")).toBe("false"));

    expect(within(section()).getAllByRole("list")).toHaveLength(2);
  });

  it("keeps fewer than ten stills in one strip", async () => {
    api.sampleStills.mockResolvedValue(Array.from({ length: 9 }, (_, n) => still(n + 1)));
    api.sampleScriptScenes.mockResolvedValue([]);
    renderReel();
    await waitFor(() => expect(section().getAttribute("aria-busy")).toBe("false"));

    expect(within(section()).getAllByRole("list")).toHaveLength(1);
  });

  it("leaves the page when the library has nothing to show", async () => {
    api.sampleStills.mockResolvedValue([]);
    api.sampleScriptScenes.mockResolvedValue([]);
    renderReel();

    await waitFor(() => expect(screen.queryByRole("region", SECTION)).toBeNull());
  });

  it("leaves the page when neither sample loads", async () => {
    api.sampleStills.mockRejectedValue(new Error("offline"));
    api.sampleScriptScenes.mockRejectedValue(new Error("offline"));
    renderReel();

    await waitFor(() => expect(screen.queryByRole("region", SECTION)).toBeNull());
  });

  it("shows the scenes when only the stills fail to load", async () => {
    api.sampleStills.mockRejectedValue(new Error("offline"));
    api.sampleScriptScenes.mockResolvedValue([SCENE]);
    renderReel();
    await waitFor(() => expect(section().getAttribute("aria-busy")).toBe("false"));

    expect(within(section()).getAllByRole("list")).toHaveLength(1);
    expect(within(section()).getAllByRole("link", { name: /^Harbor Lights, scene at / }).length).toBeGreaterThan(0);
  });
});
