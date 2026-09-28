import { describe, expect, it } from "vitest";
import { assembleLineText, buildPageTextLines, findLineAtY, lineBoxAt } from "./pageTextLines.js";

/*
 * The geometry every scene anchor rests on. Runs are given the way pdf.js gives
 * them — a transform and an advance width — because the seam this module owns is
 * exactly that shape, down to the tricks a script PDF plays: a rotated
 * watermark, hairline type, a word split across runs, and bold faked by drawing
 * the same run twice.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const VIEWPORT = {
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  scale: 1,
  convertToViewportPoint: (x, y) => [x, PAGE_HEIGHT - y],
};

/** One pdf.js text run, positioned by its baseline measured from the page top. */
function run(text, { x = 108, y = 96, size = 12, width, transform } = {}) {
  return {
    str: text,
    transform: transform ?? [size, 0, 0, size, x, PAGE_HEIGHT - y],
    width: width ?? text.length * size * 0.6,
  };
}

function pageFrom(...items) {
  return buildPageTextLines({ items }, VIEWPORT, 3);
}

describe("a line's box", () => {
  it("draws a screenplay's 12pt box around the baseline an anchor stores", () => {
    const box = lineBoxAt(96);

    expect(box.top).toBeCloseTo(86.16, 10);
    expect(box.bottom).toBeCloseTo(98.88, 10);
  });

  it("overlaps its neighbour, which is why anchors are compared as baselines", () => {
    const box = lineBoxAt(96);
    const below = lineBoxAt(108);

    expect(box.bottom - box.top).toBeGreaterThan(12);
    expect(below.top).toBeLessThan(box.bottom);
  });

  it("follows an indexed line's own font size", () => {
    const box = lineBoxAt(96, 24);

    expect(box.top).toBeCloseTo(76.32, 10);
    expect(box.bottom).toBeCloseTo(101.76, 10);
  });
});

describe("assembling a line from its runs", () => {
  it("inserts a space where the gap between runs is wider than a fraction of a character", () => {
    const line = [
      { str: "SENATE", x: 108, right: 151.2 },
      { str: "HEARING", x: 158, right: 208 },
    ];

    expect(assembleLineText(line, 12)).toBe("SENATE HEARING");
  });

  it("closes up a word split across runs, where the gap is only kerning", () => {
    const line = [
      { str: "Ma", x: 108, right: 122.4 },
      { str: "ya", x: 123, right: 137.4 },
    ];

    expect(assembleLineText(line, 12)).toBe("Maya");
  });

  it("collapses the whitespace a run carries instead of spacing it twice", () => {
    const line = [
      { str: "  MAYA\n", x: 108, right: 151.2 },
      { str: " (CONT'D) ", x: 160, right: 220 },
    ];

    expect(assembleLineText(line, 12)).toBe("MAYA (CONT'D)");
  });
});

describe("building a page's lines", () => {
  it("groups the runs on one baseline into a line, in reading order", () => {
    // Given in the order the PDF draws them, which is neither top to bottom nor
    // left to right. Capture reads lines by index, so the order is load-bearing.
    const page = pageFrom(
      run("YA", { x: 123, width: 14.4 }),
      run("Rain streaks the window.", { y: 120 }),
      run("MA", { x: 108, width: 14.4 })
    );

    expect(page).toMatchObject({ pageNumber: 3, width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(page.lines.map((line) => [line.index, line.text])).toEqual([
      [0, "MAYA"],
      [1, "Rain streaks the window."],
    ]);
    expect(page.lines[0]).toMatchObject({ baseline: 96, fontSize: 12, left: 108, right: 137.4 });
    expect(page.lines[0].top).toBeCloseTo(86.16, 10);
  });

  it("keeps a run a hair off the baseline on the line, and its neighbour's baseline off it", () => {
    const page = pageFrom(
      run("MAYA", { x: 108, y: 96 }),
      run("(CONT'D)", { x: 160, y: 99 }),
      run("Rain.", { x: 108, y: 102 })
    );

    expect(page.lines.map((line) => line.text)).toEqual(["MAYA (CONT'D)", "Rain."]);
    // A line reports the baseline of its first run: the one an anchor stores.
    expect(page.lines.map((line) => line.baseline)).toEqual([96, 102]);
  });

  it("ignores a rotated watermark, hairline type and runs with nothing in them", () => {
    const page = pageFrom(
      run("DRAFT", { transform: [0, 12, -12, 0, 300, PAGE_HEIGHT - 400] }),
      run("fine print", { size: 2, y: 200 }),
      run("   ", { y: 240 }),
      { str: null, transform: [12, 0, 0, 12, 108, PAGE_HEIGHT - 260], width: 10 },
      run("Maya waits by the register.", { y: 280 })
    );

    expect(page.lines.map((line) => line.text)).toEqual(["Maya waits by the register."]);
  });

  it("drops a run drawn twice to fake bold", () => {
    const page = pageFrom(run("SENATE", { x: 108, y: 96 }), run("SENATE", { x: 109, y: 96.4 }));

    expect(page.lines.map((line) => line.text)).toEqual(["SENATE"]);
  });

  it("indexes a page with no text content at all: a scan has no lines to anchor", () => {
    expect(buildPageTextLines(null, VIEWPORT, 5)).toEqual({
      pageNumber: 5,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      lines: [],
    });
  });
});

describe("finding the line under a point", () => {
  const page = pageFrom(
    run("INT. DINER - NIGHT", { y: 96 }),
    run("Rain streaks the window.", { y: 120 }),
    run("MAYA", { y: 180 })
  );

  it("returns the line whose box holds the point", () => {
    expect(findLineAtY(page, 96).text).toBe("INT. DINER - NIGHT");
    expect(findLineAtY(page, 122).text).toBe("Rain streaks the window.");
  });

  it("snaps to the nearer line when the point falls in the gap between two", () => {
    expect(findLineAtY(page, 104).text).toBe("INT. DINER - NIGHT");
    expect(findLineAtY(page, 107).text).toBe("Rain streaks the window.");
  });

  it("gives up past the distance the caller allows, and never gives up on any distance", () => {
    expect(findLineAtY(page, 150)).toBeNull();
    expect(findLineAtY(page, 150, 2)).toBeNull();
    // What resolving a stored anchor asks for: the nearest line, however far.
    expect(findLineAtY(page, 150, Infinity).text).toBe("MAYA");
  });

  it("has nothing to find on a page without lines", () => {
    expect(findLineAtY(pageFrom(), 96, Infinity)).toBeNull();
    expect(findLineAtY(null, 96)).toBeNull();
  });
});
