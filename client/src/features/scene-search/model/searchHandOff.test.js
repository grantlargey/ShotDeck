import { describe, expect, it } from "vitest";
import { getHandedOverSearchBox, searchHandOffState } from "./searchHandOff.js";

describe("the search hand-off", () => {
  it("carries the field's box to Script Search as plain numbers", () => {
    // A DOMRect keeps its sides on its prototype, so they're copied out one by one.
    const rect = Object.create({ left: 410, top: 441, width: 640, height: 64 });
    const state = searchHandOffState(rect);

    expect(state).toEqual({ searchFrom: { left: 410, top: 441, width: 640, height: 64 } });
    expect(getHandedOverSearchBox(state)).toEqual({ left: 410, top: 441, width: 640, height: 64 });
  });

  it("hands nothing over without a field", () => {
    expect(searchHandOffState(null)).toBeUndefined();
  });

  it("finds nothing in other pages' state, or none", () => {
    expect(getHandedOverSearchBox(undefined)).toBeNull();
    expect(getHandedOverSearchBox({ posterUrl: "https://media.test/p.jpg" })).toBeNull();
    expect(getHandedOverSearchBox({ searchFrom: { left: 1, top: "2", height: 3 } })).toBeNull();
  });
});
