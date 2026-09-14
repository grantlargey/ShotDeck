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
