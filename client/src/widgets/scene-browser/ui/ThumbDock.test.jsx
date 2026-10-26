import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockTile, ThumbDock } from "./ThumbDock.jsx";
import styles from "./ThumbDock.module.css";

// The scene browser the dock belongs to: pinned 56px down, its top wherever the test puts it.
let browserTop;
const browser = document.createElement("div");
browser.style.setProperty("--browser-top", "56px");
browser.getBoundingClientRect = () => ({ top: browserTop });
const browserRef = { current: browser };

function scrollTo(y, { reader = true } = {}) {
  if (reader) fireEvent.wheel(window);
  act(() => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: y });
    window.dispatchEvent(new Event("scroll"));
  });
}

const dock = () => screen.getByRole("toolbar");

beforeEach(() => {
  browserTop = 0;
  document.body.append(browser);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  // Frames run at once. Returning 0 leaves no frame pending, as when one has run.
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback();
    return 0;
  });
  window.scrollTo = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  browser.remove();
});

describe("ThumbDock", () => {
  it("holds a page's own tools until the scene browser comes up to where it pins", () => {
    browserTop = 2000;
    render(
      <ThumbDock
        browserRef={browserRef}
        lead={<DockTile label="Back to the script" />}
        elsewhere={{ label: "Script tools", tools: <DockTile label="Search all scripts" /> }}
      >
        <DockTile label="Filters" />
      </ThumbDock>
    );
    expect(dock().getAttribute("aria-label")).toBe("Script tools");
    expect(screen.getByRole("button", { name: "Search all scripts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();
    expect(document.documentElement.dataset.thumbDock).toBe("");

    browserTop = 60;
    scrollTo(900, { reader: false });
    expect(dock().getAttribute("aria-label")).toBe("Scene tools");
    expect(screen.getByRole("button", { name: "Back to the script" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search all scripts" })).toBeNull();
  });

  it("unfolds the way to the top once the reader is a screen down", () => {
    render(
      <ThumbDock browserRef={browserRef}>
        <DockTile label="Filters" />
      </ThumbDock>
    );
    const backToTop = () => screen.getByRole("button", { name: "Back to top" });
    expect(backToTop().closest("[inert]")).not.toBeNull();

    scrollTo(window.innerHeight + 100);
    expect(backToTop().closest("[inert]")).toBeNull();
    fireEvent.click(backToTop());
    expect(window.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
  });

  it("steps aside while the reader scrolls down, not while the page moves itself", () => {
    render(
      <ThumbDock browserRef={browserRef}>
        <DockTile label="Filters" />
      </ThumbDock>
    );
    const away = () => dock().classList.contains(styles.away);
    scrollTo(400, { reader: false });
    expect(away()).toBe(false);
    scrollTo(800);
    expect(away()).toBe(true);
    scrollTo(700);
    expect(away()).toBe(false);
  });

  it("leaves altogether when hidden, as in focused reading", () => {
    const { rerender } = render(
      <ThumbDock browserRef={browserRef}>
        <DockTile label="Filters" />
      </ThumbDock>
    );
    rerender(
      <ThumbDock browserRef={browserRef} hidden>
        <DockTile label="Filters" />
      </ThumbDock>
    );
    expect(dock().hasAttribute("inert")).toBe(true);
    expect(dock().classList.contains(styles.away)).toBe(true);
  });
});
