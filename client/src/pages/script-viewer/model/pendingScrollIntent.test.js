import { describe, expect, it } from "vitest";
import { nextScrollAction } from "./pendingScrollIntent.js";

/*
 * The four ways a deep link's pending scroll ends, and the order they are read
 * in. Before this module the rule lived as three interdependent booleans in the
 * script viewer page and was only reachable through it.
 */

const INDEXED = new Map([[4, { pageNumber: 4 }]]);

/** A loaded document whose page 4 is indexed and whose indexing is still running. */
function viewer(overrides = {}) {
  return {
    numPages: 120,
    indexedPages: INDEXED,
    indexComplete: false,
    activeSceneId: "scene-1",
    ...overrides,
  };
}

/** An intent for a scene whose script location sits on page 4. */
function sceneIntent(overrides = {}) {
  return {
    page: 4,
    offsetPt: 120,
    location: { start: { page: 4, y: 120 }, end: { page: 4, y: 300 } },
    sceneId: "scene-1",
    ...overrides,
  };
}

describe("nothing waiting", () => {
  it("waits when there is no intent", () => {
    expect(nextScrollAction(null, viewer())).toBe("wait");
  });
});

describe("the reader has moved on", () => {
  it("drops an intent whose scene is no longer the scene in hand", () => {
    expect(nextScrollAction(sceneIntent(), viewer({ activeSceneId: "scene-2" }))).toBe("drop");
  });

  it("drops it even when its page is ready to scroll to", () => {
    const ready = viewer({ activeSceneId: "scene-2", numPages: 120 });
    expect(nextScrollAction(sceneIntent(), ready)).toBe("drop");
  });

  it("drops it in preference to abandoning it, so only one thing is said", () => {
    const gone = viewer({ activeSceneId: "scene-2", indexComplete: true, indexedPages: new Map() });
    expect(nextScrollAction(sceneIntent(), gone)).toBe("drop");
  });

  it("keeps an intent that carries no scene, such as a ?page= link", () => {
    const pageLink = { page: 4, offsetPt: null };
    expect(nextScrollAction(pageLink, viewer({ activeSceneId: "scene-2" }))).toBe("run");
  });
});

describe("the page is never coming", () => {
  it("abandons a location whose page is still missing once indexing is complete", () => {
    const done = viewer({ indexComplete: true, indexedPages: new Map() });
    expect(nextScrollAction(sceneIntent(), done)).toBe("abandon");
  });

  it("keeps waiting while indexing is still running", () => {
    const running = viewer({ indexedPages: new Map() });
    expect(nextScrollAction(sceneIntent(), running)).toBe("wait");
  });

  it("never abandons a page link, which needs no indexed text", () => {
    const pageLink = { page: 900, offsetPt: null };
    const done = viewer({ indexComplete: true, indexedPages: new Map() });
    expect(nextScrollAction(pageLink, done)).toBe("run");
  });
});

describe("ready to scroll", () => {
  it("runs once the location's page is indexed", () => {
    expect(nextScrollAction(sceneIntent(), viewer())).toBe("run");
  });

  it("waits until the document reports its pages", () => {
    expect(nextScrollAction(sceneIntent(), viewer({ numPages: 0 }))).toBe("wait");
  });

  it("waits for a page link too until the document is loaded", () => {
    const pageLink = { page: 4, offsetPt: null };
    expect(nextScrollAction(pageLink, viewer({ numPages: 0 }))).toBe("wait");
  });
});
