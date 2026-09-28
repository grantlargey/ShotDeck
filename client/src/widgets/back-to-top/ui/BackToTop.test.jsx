import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackToTop from "./BackToTop.jsx";

let scrollY = 0;

function scrollWindowTo(y) {
  scrollY = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  scrollY = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWithSkipLink() {
  return render(
    <>
      <a id="skip-link" href="#main">
        Skip to content
      </a>
      <BackToTop focusTargetId="skip-link" />
    </>
  );
}

describe("BackToTop", () => {
  it("stays out of the way until the reader is two screens down", () => {
    renderWithSkipLink();
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();

    scrollWindowTo(window.innerHeight * 2 - 1);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();

    scrollWindowTo(window.innerHeight * 2 + 1);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
  });

  it("scrolls to the top and hands focus to the first stop on the page", () => {
    renderWithSkipLink();
    scrollWindowTo(5000);

    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Skip to content" }));
  });
});
