import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showSavedSceneTextStyle } from "../model/sceneTextStyle.js";
import { SceneTextStyleToggle } from "./SceneTextStyleToggle.jsx";

function toggle() {
  return screen.getByRole("button", { name: /^Page style/ });
}

/** The styles of the pages the toggle holds, back to front; null is the visitor's current style. */
function pages() {
  return [...toggle().querySelectorAll("svg")].map((svg) => svg.getAttribute("data-scene-text-style"));
}

const shown = () => document.documentElement.dataset.sceneTextStyle;

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.sceneTextStyle;
  showSavedSceneTextStyle();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the page style toggle", () => {
  it("turns to the next page style on each click: white, cream, blue, then white again", () => {
    render(<SceneTextStyleToggle />);

    expect(shown()).toBe("reading");
    fireEvent.click(toggle());
    expect(shown()).toBe("cream");
    fireEvent.click(toggle());
    expect(shown()).toBe("midnight");
    fireEvent.click(toggle());
    expect(shown()).toBe("reading");
  });

  it("tells screen readers which page it shows and which comes next, and shows no name on screen", () => {
    render(<SceneTextStyleToggle />);

    expect(toggle().getAttribute("aria-label")).toBe("Page style: Reading Edition. Turn to Cream Paper");
    expect(toggle().textContent).toBe("");
  });

  it("keeps the other two styles' pages behind its own, ready to fan out on hover", () => {
    render(<SceneTextStyleToggle />);

    expect(pages()).toEqual(["midnight", "cream", null]);
  });

  it("plays a turn on click, the old page leaving as the new one arrives, then settles back", () => {
    vi.useFakeTimers();
    render(<SceneTextStyleToggle />);

    fireEvent.click(toggle());
    expect(pages()).toEqual(["reading", null]);

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(pages()).toEqual(["reading", "midnight", null]);
  });

  it("works the same in a tool bar, and can be shown but not used", () => {
    const { rerender } = render(<SceneTextStyleToggle look="toolbar" />);

    fireEvent.click(toggle());
    expect(shown()).toBe("cream");

    rerender(<SceneTextStyleToggle look="toolbar" disabled />);
    fireEvent.click(toggle());
    expect(toggle().disabled).toBe(true);
    expect(shown()).toBe("cream");
  });
});
