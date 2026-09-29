import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadImages } from "./preloadImages.js";

/*
 * The jsdom stand-in in the test setup answers every image on the next tick,
 * and fails the ones whose URL reads as "broken". A URL that should still be in
 * flight when the deadline passes is held back here instead, by getting in
 * front of that stand-in.
 */

const DEADLINE_MS = 5000;

/** Keeps these URLs from ever answering, so the deadline is what ends the wait. */
function stallSources(urls) {
  const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  const spy = vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function set(value) {
    if (!urls.includes(value)) source.set.call(this, value);
  });
  return spy;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("preloading images", () => {
  it("answers with the URLs the browser got", async () => {
    const loaded = await preloadImages(["https://media.test/a.jpg", "https://media.test/b.jpg"], {
      deadlineMs: DEADLINE_MS,
    });

    expect([...loaded].sort()).toEqual(["https://media.test/a.jpg", "https://media.test/b.jpg"]);
  });

  it("leaves out a URL that can't be loaded", async () => {
    const loaded = await preloadImages(["https://media.test/a.jpg", "https://media.test/broken.jpg"], {
      deadlineMs: DEADLINE_MS,
    });

    expect([...loaded]).toEqual(["https://media.test/a.jpg"]);
  });

  it("answers with nothing to wait for at once", async () => {
    await expect(preloadImages([], { deadlineMs: DEADLINE_MS })).resolves.toEqual(new Set());
  });

  it("gives up on a URL still in flight at the deadline and keeps the rest", async () => {
    vi.useFakeTimers();
    const slow = "https://media.test/slow.jpg";
    stallSources([slow]);

    const waiting = preloadImages([slow, "https://media.test/quick.jpg"], { deadlineMs: DEADLINE_MS });
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);

    expect([...(await waiting)]).toEqual(["https://media.test/quick.jpg"]);
  });
});
