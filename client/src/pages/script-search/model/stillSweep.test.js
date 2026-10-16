import { describe, expect, it } from "vitest";
import { sweepDelays } from "./stillSweep.js";

// Two rows of three 348px cards, 16px apart.
const GRID = [0, 364, 728, 0, 364, 728].map((left) => ({ left, right: left + 348 }));

describe("sweepDelays", () => {
  it("sweeps in left to right, column by column", () => {
    expect(sweepDelays("in", GRID)).toEqual([0, 182, 364, 0, 182, 364]);
  });

  it("sweeps away right to left", () => {
    expect(sweepDelays("out", GRID)).toEqual([364, 182, 0, 364, 182, 0]);
  });

  it("crosses a very wide grid in no more than 600ms", () => {
    const wide = Array.from({ length: 8 }, (_, column) => ({ left: column * 276, right: column * 276 + 260 }));
    const delays = sweepDelays("in", wide);

    expect(delays[0]).toBe(0);
    expect(delays[7]).toBe(600);
  });

  it("moves a single column all at once", () => {
    expect(sweepDelays("in", [{ left: 16, right: 384 }, { left: 16, right: 384 }])).toEqual([0, 0]);
    expect(sweepDelays("out", [])).toEqual([]);
  });
});
