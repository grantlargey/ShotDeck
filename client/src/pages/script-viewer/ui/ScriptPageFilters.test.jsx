import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { colorChannels, duotoneMatrix } from "../lib/duotone.js";
import { ScriptPageFilters } from "./ScriptPageFilters.jsx";

/** Runs a pixel through an feColorMatrix's values, as whole 0–255 channels. */
function apply(values, [r, g, b]) {
  const m = values.split(" ").map(Number);
  return [0, 1, 2].map((row) => {
    const [cr, cg, cb, ca, offset] = m.slice(row * 5, row * 5 + 5);
    return Math.round((cr * r + cg * g + cb * b + ca * 1 + offset) * 255);
  });
}

const bytes = (channels) => channels.map((value) => Math.round(value * 255));

describe("recoloring the script's pages", () => {
  const ink = colorChannels("#d4dcec");
  const paper = colorChannels("rgb(12, 19, 36)");

  it("reads a token's color written either way, and nothing else", () => {
    expect(bytes(ink)).toEqual([212, 220, 236]);
    expect(bytes(paper)).toEqual([12, 19, 36]);
    expect(colorChannels("")).toBeNull();
    expect(colorChannels("navy")).toBeNull();
  });

  it("paints the PDF's black as the style's ink and its white as the paper, light on dark included", () => {
    const matrix = duotoneMatrix(ink, paper);

    expect(apply(matrix, [0, 0, 0])).toEqual([212, 220, 236]);
    expect(apply(matrix, [1, 1, 1])).toEqual([12, 19, 36]);
    apply(matrix, [0.5, 0.5, 0.5]).forEach((channel, index) => {
      expect(Math.abs(channel - (bytes(ink)[index] + bytes(paper)[index]) / 2)).toBeLessThanOrEqual(1);
    });
  });

  it("keeps a filter for each recolored style, passing the page through until its colors can be read", () => {
    const { container } = render(<ScriptPageFilters />);

    expect([...container.querySelectorAll("filter")].map((filter) => filter.id)).toEqual([
      "script-page-cream",
      "script-page-midnight",
    ]);
    expect(container.querySelector("feColorMatrix").getAttribute("values")).toBe("1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0");
  });
});
