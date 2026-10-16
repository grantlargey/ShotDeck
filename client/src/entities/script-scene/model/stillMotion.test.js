import { describe, expect, it } from "vitest";
import { planStillMotion } from "./stillMotion.js";

describe("planStillMotion", () => {
  it("opens the frames at once and lasts until the last still has turned positive", () => {
    expect(planStillMotion("in", [0, 182, 364])).toEqual({
      phase: "in",
      delays: [0, 182, 364],
      frameDelay: 0,
      duration: 120 + 364 + 1060,
    });
  });

  it("closes the frames together once the last still has faded", () => {
    expect(planStillMotion("out", [364, 182, 0])).toEqual({
      phase: "out",
      delays: [364, 182, 0],
      frameDelay: 364 + 600,
      duration: 364 + 600 + 320,
    });
  });

  it("plays without a stagger for an empty grid", () => {
    expect(planStillMotion("out", [])).toMatchObject({ frameDelay: 600, duration: 920 });
  });
});
