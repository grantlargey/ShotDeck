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
  it("shows Reading Edition when this browser has saved nothing", () => {
    showSavedSceneTextStyle();

    expect(shownStyle()).toBe("reading");
    expect(getSceneTextStyle()).toBe("reading");
  });

  it("shows the style this browser saved", () => {
    window.localStorage.setItem(STORAGE_KEY, "midnight");
    showSavedSceneTextStyle();

    expect(shownStyle()).toBe("midnight");
  });

  it("falls back to Reading Edition when the saved value isn't a style", () => {
    window.localStorage.setItem(STORAGE_KEY, "neon");
    showSavedSceneTextStyle();

    expect(shownStyle()).toBe("reading");
  });

  it("shows a pick at once and remembers it for the next visit", () => {
    setSceneTextStyle("cream");

    expect(shownStyle()).toBe("cream");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("cream");
  });

  it("ignores a style that doesn't exist", () => {
    setSceneTextStyle("midnight");
    setSceneTextStyle("neon");

    expect(shownStyle()).toBe("midnight");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("midnight");
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
    expect(shownStyle()).toBe("reading");

    setSceneTextStyle("midnight");
    expect(shownStyle()).toBe("midnight");
  });
});
