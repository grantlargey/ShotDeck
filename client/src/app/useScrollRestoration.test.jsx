import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollRestoration } from "./useScrollRestoration.js";

/*
 * Scroll positions across navigation. jsdom has no layout, so the window's
 * scroll position and the page's height are doubled here; the router and the
 * hook are real.
 */

let scrollY = 0;
let pageHeight = 10000;
let resizeCallbacks = [];
let scrollDescriptor;
let heightDescriptor;

class FakeResizeObserver {
  constructor(callback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  disconnect() {}
}

function scrollWindowTo(y) {
  scrollY = y;
  window.dispatchEvent(new Event("scroll"));
}

/** Content arrives and the page grows. */
function growPageTo(height) {
  pageHeight = height;
  act(() => resizeCallbacks.forEach((callback) => callback()));
}

function Harness() {
  useScrollRestoration();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/b")}>Other page</button>
      <button onClick={() => navigate("/a?filter=on")}>Filter</button>
      <button onClick={() => navigate("/a?filter=off", { replace: true })}>Refine</button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function renderAt(path = "/a") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>
  );
}

const click = (name) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  scrollY = 0;
  pageHeight = 10000;
  resizeCallbacks = [];
  window.sessionStorage.clear();
  scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
  heightDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, "scrollHeight");
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => pageHeight });
  vi.spyOn(window, "scrollTo").mockImplementation((x, y) => scrollWindowTo(typeof x === "object" ? x.top : y));
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  if (scrollDescriptor) Object.defineProperty(window, "scrollY", scrollDescriptor);
  else delete window.scrollY;
  if (heightDescriptor) Object.defineProperty(document.documentElement, "scrollHeight", heightDescriptor);
  else delete document.documentElement.scrollHeight;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useScrollRestoration", () => {
  it("starts a newly opened page at the top", () => {
    renderAt();
    scrollWindowTo(1200);

    click("Other page");

    expect(scrollY).toBe(0);
  });

  it("returns to the reader's place on Back and Forward", () => {
    renderAt();
    scrollWindowTo(1200);
    click("Other page");
    scrollWindowTo(300);

    click("Back");
    expect(scrollY).toBe(1200);

    click("Forward");
    expect(scrollY).toBe(300);
  });

  it("keeps the reader's place when only the query string changes", () => {
    renderAt();
    scrollWindowTo(500);

    click("Filter");

    expect(scrollY).toBe(500);
  });

  /*
   * A query-only entry is the one entry the reader never scrolls on arrival,
   * because arriving is what leaves them where they were. Its place therefore
   * has to be remembered for it, or Forward into it reads as the top.
   */
  it("returns to the inherited place on Forward into a pushed query-only entry", () => {
    renderAt();
    scrollWindowTo(500);
    click("Filter");

    click("Back");
    expect(scrollY).toBe(500);
    // The reader moves on the page they came back to, so the place Forward
    // finds can only have come from the query-only entry itself.
    scrollWindowTo(120);

    click("Forward");
    expect(scrollY).toBe(500);
  });

  it("returns to the inherited place on Forward into a replaced query-only entry", () => {
    renderAt();
    scrollWindowTo(500);
    click("Filter");
    click("Refine");
    expect(scrollY).toBe(500);

    click("Back");
    expect(scrollY).toBe(500);
    scrollWindowTo(120);

    click("Forward");
    expect(scrollY).toBe(500);
  });

  it("keeps re-applying the position while the page's content loads", () => {
    renderAt();
    scrollWindowTo(4000);
    click("Other page");
    // Back lands on a page that hasn't loaded yet: only the header and a skeleton.
    pageHeight = 1200;

    click("Back");
    expect(scrollY).toBe(1200 - window.innerHeight);

    growPageTo(9000);
    expect(scrollY).toBe(4000);
  });

  it("stops re-applying once the reader scrolls on their own", () => {
    renderAt();
    scrollWindowTo(4000);
    click("Other page");
    pageHeight = 1200;
    click("Back");

    window.dispatchEvent(new Event("wheel"));
    growPageTo(9000);

    expect(scrollY).toBe(1200 - window.innerHeight);
  });

  it("doesn't carry a position over to a fresh load of the tab", () => {
    // Every first page a tab loads gets the key "default", whatever its URL.
    window.sessionStorage.setItem("scriptdeck:scroll-positions", JSON.stringify({ "default|/a": 900 }));

    renderAt("/a");

    expect(scrollY).toBe(0);
  });
});


it("retains a remembered target when navigation interrupts a clamped restore", () => {
  renderAt();
  scrollWindowTo(4000);
  click("Other page");
  pageHeight = 1200;
  click("Back");
  expect(scrollY).toBe(1200 - window.innerHeight);
  click("Forward");
  pageHeight = 9000;
  click("Back");
  expect(scrollY).toBe(4000);
});
