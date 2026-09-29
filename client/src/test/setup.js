import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library can't register this itself.
afterEach(() => {
  cleanup();
});

// jsdom has no layout: ScreenplayEditor observes its sheet's size, and the
// viewer scrolls the scenes section into view.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= NoopResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

// jsdom has no decoder. An image that loaded here is ready to draw.
HTMLImageElement.prototype.decode ??= function decode() {
  return Promise.resolve();
};

/*
 * jsdom never fetches an image either, so it never fires load or error and
 * anything waiting on one waits forever. This stand-in answers on the next
 * tick: a source loads, unless it reads as "broken", which is how a test gives
 * an image a URL that fails. It stands in for both `new Image()` and a rendered
 * <img>, since the two are the same element.
 */
const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
Object.defineProperty(HTMLImageElement.prototype, "src", {
  ...source,
  set(value) {
    source.set.call(this, value);
    const answering = source.get.call(this);
    const failed = /broken/i.test(value);
    queueMicrotask(() => {
      if (source.get.call(this) !== answering) return; // Replaced before this one could answer.
      this.dispatchEvent(new Event(failed ? "error" : "load"));
    });
  },
});
