import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCENE_TEXT_STYLES,
  getSceneTextStyle,
  nextSceneTextStyle,
  setSceneTextStyle,
  showSavedSceneTextStyle,
} from "./sceneTextStyle.js";

const STORAGE_KEY = "scriptdeck:scene-text-style";

function shownStyle() {
  return document.documentElement.dataset.sceneTextStyle;
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.sceneTextStyle;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the scene text style", () => {
  it("shows Midnight Edition when this browser has saved nothing", () => {
    showSavedSceneTextStyle();

    expect(shownStyle()).toBe("midnight");
    expect(getSceneTextStyle()).toBe("midnight");
  });

  it("shows the style this browser saved", () => {
    window.localStorage.setItem(STORAGE_KEY, "reading");
    showSavedSceneTextStyle();

    expect(shownStyle()).toBe("reading");
  });

  it("falls back to Midnight Edition when the saved value isn't a style", () => {
    window.localStorage.setItem(STORAGE_KEY, "neon");
    showSavedSceneTextStyle();

    expect(shownStyle()).toBe("midnight");
  });

  it("shows a pick at once and remembers it for the next visit", () => {
    setSceneTextStyle("cream");

    expect(shownStyle()).toBe("cream");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("cream");
  });

  it("ignores a style that doesn't exist", () => {
    setSceneTextStyle("cream");
    setSceneTextStyle("neon");

    expect(shownStyle()).toBe("cream");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("cream");
  });

  it("offers white, then cream, then blue, and steps through them in that order", () => {
    expect(SCENE_TEXT_STYLES.map((style) => style.value)).toEqual(["reading", "cream", "midnight"]);
    expect(nextSceneTextStyle("reading")).toBe("cream");
    expect(nextSceneTextStyle("cream")).toBe("midnight");
    expect(nextSceneTextStyle("midnight")).toBe("reading");
  });

  it("still shows a pick when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    showSavedSceneTextStyle();
    expect(shownStyle()).toBe("midnight");

    setSceneTextStyle("cream");
    expect(shownStyle()).toBe("cream");
  });
});
