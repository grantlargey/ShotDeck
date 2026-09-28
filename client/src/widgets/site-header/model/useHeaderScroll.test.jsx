import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHeaderScroll } from "./useHeaderScroll.js";

/*
 * The pinned header's slide-away rules. jsdom has no layout and no real
 * viewport, so the window's scroll position, the header's own height and the
 * phone media query are all faked here; the hook is real, and so is focus -
 * jsdom moves document.activeElement and fires focusin the way a browser does,
 * which is what the focus rule rests on.
 */

// Mirrors PHONE_QUERY in the hook, so the fake only answers about phone width.
const PHONE_QUERY = "(max-width: 780px)";
const HEADER_HEIGHT = 64;

let scrollY = 0;
let isPhone = true;
let mediaListeners = [];
let scrollDescriptor;
let heightDescriptor;
let matchMediaDescriptor;

function fakeMatchMedia(query) {
  return {
    media: query,
    get matches() {
      return query === PHONE_QUERY && isPhone;
    },
    addEventListener(type, listener) {
      mediaListeners.push(listener);
    },
    removeEventListener(type, listener) {
      mediaListeners = mediaListeners.filter((registered) => registered !== listener);
    },
  };
}

function scrollWindowTo(y) {
  scrollY = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

/** The window is dragged past phone width, or the phone is turned. */
function leavePhoneWidth() {
  isPhone = false;
  act(() => {
    mediaListeners.forEach((listener) => listener());
  });
}

function Harness({ pinned = true }) {
  const headerRef = useRef(null);
  const { scrolled, hidden } = useHeaderScroll(headerRef, { enabled: pinned });
  return (
    <>
      <header ref={headerRef}>
        <a href="/">Brand</a>
      </header>
      <button type="button">Somewhere in the page</button>
      <div data-testid="state" data-hidden={String(hidden)} data-scrolled={String(scrolled)} />
    </>
  );
}

const isHidden = () => screen.getByTestId("state").dataset.hidden === "true";
const isScrolled = () => screen.getByTestId("state").dataset.scrolled === "true";
const headerOffsetIsZeroed = () => document.documentElement.dataset.siteHeader === "hidden";
const focusInHeader = () => act(() => screen.getByRole("link", { name: "Brand" }).focus());
const focusInPage = () => act(() => screen.getByRole("button", { name: "Somewhere in the page" }).focus());

beforeEach(() => {
  scrollY = 0;
  isPhone = true;
  mediaListeners = [];
  scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
  heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => HEADER_HEIGHT });
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: fakeMatchMedia });
});

afterEach(() => {
  // Restoring the descriptors is on us: vi.restoreAllMocks() leaves them alone.
  if (scrollDescriptor) Object.defineProperty(window, "scrollY", scrollDescriptor);
  else delete window.scrollY;
  if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", heightDescriptor);
  else delete HTMLElement.prototype.offsetHeight;
  if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
  else delete window.matchMedia;
});

describe("the pinned header on a phone", () => {
  it("slides away as the reader scrolls down", () => {
    render(<Harness />);
    expect(isHidden()).toBe(false);

    scrollWindowTo(400);

    expect(isHidden()).toBe(true);
    expect(isScrolled()).toBe(true);
  });

  it("comes back on any scroll up, however small the page has moved on", () => {
    render(<Harness />);
    scrollWindowTo(400);

    scrollWindowTo(380);

    expect(isHidden()).toBe(false);
  });

  it("stays put while the reader is near the top", () => {
    render(<Harness />);

    // Downward, and far enough to clear the jitter gate, but still within the
    // header's own height: there is nothing yet to slide away from.
    scrollWindowTo(HEADER_HEIGHT - 10);

    expect(isHidden()).toBe(false);
  });

  it("measures jitter against the last real move, not the jitter", () => {
    render(<Harness />);
    scrollWindowTo(400);

    // Two nudges up, each under the gate on its own. The first is ignored
    // without moving the mark it is measured from, so the second - eight from
    // 400, not four from 396 - reads as the scroll up it really is.
    scrollWindowTo(396);
    expect(isHidden()).toBe(true);

    scrollWindowTo(392);
    expect(isHidden()).toBe(false);
  });
});

describe("the pinned header above phone width", () => {
  it("never slides away", () => {
    isPhone = false;
    render(<Harness />);

    scrollWindowTo(400);

    expect(isHidden()).toBe(false);
    expect(isScrolled()).toBe(true);
  });

  it("returns as soon as the window grows past a phone", () => {
    render(<Harness />);
    scrollWindowTo(400);
    expect(isHidden()).toBe(true);

    leavePhoneWidth();

    expect(isHidden()).toBe(false);
  });
});

describe("the header while it holds focus", () => {
  it("comes back when Tab reaches it after it has slid away", () => {
    render(<Harness />);
    scrollWindowTo(400);
    expect(isHidden()).toBe(true);

    focusInHeader();

    expect(isHidden()).toBe(false);
  });

  it("stays on screen however far the reader scrolls down", () => {
    render(<Harness />);
    focusInHeader();

    scrollWindowTo(400);
    scrollWindowTo(900);

    expect(isHidden()).toBe(false);
  });

  it("is free to slide away again once focus has moved on", () => {
    render(<Harness />);
    scrollWindowTo(400);
    focusInHeader();

    focusInPage();
    scrollWindowTo(600);

    expect(isHidden()).toBe(true);
  });
});

/*
 * app/styles/index.css reads data-site-header="hidden" off <html> to zero
 * --sd-header-offset, so sticky page parts can move up into the space a slid
 * away header leaves. A flag left behind would hold them there under a header
 * that is back on screen.
 */
describe("the header-away flag on <html>", () => {
  it("is raised while the header is away and dropped when it returns", () => {
    render(<Harness />);
    expect(headerOffsetIsZeroed()).toBe(false);

    scrollWindowTo(400);
    expect(headerOffsetIsZeroed()).toBe(true);

    scrollWindowTo(380);
    expect(headerOffsetIsZeroed()).toBe(false);
  });

  it("is dropped when a page unmounts its header mid-slide", () => {
    const { unmount } = render(<Harness />);
    scrollWindowTo(400);
    expect(headerOffsetIsZeroed()).toBe(true);

    unmount();

    expect(headerOffsetIsZeroed()).toBe(false);
  });
});

describe("a header that isn't pinned", () => {
  it("scrolls with the page and never slides", () => {
    render(<Harness pinned={false} />);

    scrollWindowTo(400);

    expect(isHidden()).toBe(false);
    expect(isScrolled()).toBe(false);
    expect(headerOffsetIsZeroed()).toBe(false);
  });
});
