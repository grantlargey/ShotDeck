import { afterEach, describe, expect, it, vi } from "vitest";
import { glideKeyframes, setFiltersFolded } from "./filterFold.js";

const STORAGE_KEY = "scriptdeck:scene-filters-folded";

afterEach(() => {
  vi.restoreAllMocks();
  setFiltersFolded(false);
});

describe("glideKeyframes", () => {
  it("leaves an element that hasn't moved where it is", () => {
    expect(glideKeyframes({ left: 40, top: 100 }, { left: 40.2, top: 99.7 })).toBeNull();
  });

  it("glides a card along its row", () => {
    expect(glideKeyframes({ left: 328, top: 100 }, { left: 64, top: 100 })).toEqual([
      { transform: "translate(264px, 0px)" },
      { transform: "none" },
    ]);
  });

  it("dims a card that wraps onto another row as it crosses the grid", () => {
    expect(glideKeyframes({ left: 328, top: 420 }, { left: 1000, top: 100 })).toEqual([
      { transform: "translate(-672px, 320px)", opacity: 1 },
      { opacity: 0.35, offset: 0.45 },
      { transform: "none", opacity: 1 },
    ]);
  });
});

describe("setFiltersFolded", () => {
  it("remembers the filters folded away and forgets it when they come back", () => {
    setFiltersFolded(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
    setFiltersFolded(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("still folds when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setFiltersFolded(true)).not.toThrow();
  });
});
