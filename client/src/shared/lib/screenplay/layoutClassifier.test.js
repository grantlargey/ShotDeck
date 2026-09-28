import { describe, expect, it } from "vitest";
import { buildPageTextLines } from "../pdf-text/pageTextLines.js";
import { estimateActionMargin, screenplayElementsFromLayout } from "./layoutClassifier.js";

/*
 * Synthetic screenplay pages for the layout classifier: pdf.js-like text runs
 * placed in PDF points and fed through the real line builder, so the classifier
 * sees the geometry it sees in the viewer. These pages carry the artifacts a
 * script PDF carries and the classifier exists to strip — scene numbers in both
 * margins, revision asterisks, page furniture, (MORE) and (CONT'D) — which the
 * clean pages used elsewhere in the tests have none of.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CHAR_WIDTH_RATIO = 0.6;

const ACTION_X = 108;
const DIALOGUE_X = 180;
const CUE_X = 252;
const TRANSITION_X = 450;

/** One line of text runs at the baseline `y`, measured from the top of the page. */
function line(y, ...runs) {
  return { y, runs: runs.map(([x, text]) => ({ x, text })) };
}

function positionedPage(pageNumber, lines, { size = 12 } = {}) {
  const items = lines.flatMap(({ y, runs }) =>
    runs.map(({ x, text }) => ({
      str: text,
      transform: [size, 0, 0, size, x, PAGE_HEIGHT - y],
      width: text.length * size * CHAR_WIDTH_RATIO,
    }))
  );
  const viewport = {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    scale: 1,
    convertToViewportPoint: (x, y) => [x, PAGE_HEIGHT - y],
  };
  return buildPageTextLines({ items }, viewport, pageNumber);
}

/** Every page here is set at the standard action margin, so say so once. */
function classify(pages) {
  return screenplayElementsFromLayout(pages, { actionMargin: ACTION_X });
}

describe("artifacts around the body text", () => {
  it("drops the scene numbers in both margins of a heading", () => {
    const page = positionedPage(1, [
      line(120, [72, "12."], [ACTION_X, "INT. HOUSE - NIGHT"], [504, "12."]),
      line(144, [ACTION_X, "Dust hangs in the hallway light."]),
    ]);

    expect(classify([page])).toEqual([
      { type: "heading", text: "INT. HOUSE - NIGHT" },
      { type: "action", text: "Dust hangs in the hallway light." },
    ]);
  });

  it("unwraps a numbered heading set inside the body, keeping the year it ends on", () => {
    // These numbers sit too far in to be read as margin artifacts by position,
    // so only the repeated number itself may go: "1902" is part of the heading.
    const page = positionedPage(1, [
      line(120, [88, "12"], [ACTION_X, "INT. HOUSE - LATER - 1902"], [420, "12"]),
      line(168, [ACTION_X, "EXT. FIELD - DAY - 1902"]),
    ]);

    expect(classify([page])).toEqual([
      { type: "heading", text: "INT. HOUSE - LATER - 1902" },
      { type: "heading", text: "EXT. FIELD - DAY - 1902" },
    ]);
  });

  it("drops revision asterisks, whether they trail the text or stand alone", () => {
    const page = positionedPage(1, [
      line(120, [ACTION_X, "She lifts the latch and listens.   *"]),
      line(144, [ACTION_X, "Nothing answers."], [540, "*"]),
      line(168, [540, "*"]),
    ]);

    expect(classify([page])).toEqual([
      { type: "action", text: "She lifts the latch and listens." },
      { type: "action", text: "Nothing answers." },
    ]);
  });

  it("drops the page furniture above, below and around the body", () => {
    const page = positionedPage(1, [
      line(40, [ACTION_X, "THE LAST DINER - Rev. 3/12/24"]),
      line(80, [300, "23."]),
      line(120, [ACTION_X, "Maya locks the door."]),
      line(744, [432, "(CONTINUED)"]),
      line(776, [540, "23."]),
    ]);

    expect(classify([page])).toEqual([{ type: "action", text: "Maya locks the door." }]);
  });
});

describe("a speech broken over a page break", () => {
  it("keeps one speech and one cue through (MORE) and the repeated (CONT'D) cue", () => {
    const pageOne = positionedPage(4, [
      line(600, [CUE_X, "MAYA"]),
      line(612, [DIALOGUE_X, "You can sit anywhere you"]),
      line(624, [DIALOGUE_X, "like, but the kitchen is"]),
      line(648, [CUE_X, "(MORE)"]),
    ]);
    const pageTwo = positionedPage(5, [
      line(96, [CUE_X, "MAYA (CONT'D)"]),
      line(108, [DIALOGUE_X, "closed for the night."]),
    ]);

    expect(classify([pageOne, pageTwo])).toEqual([
      { type: "character", text: "MAYA" },
      { type: "dialogue", text: "You can sit anywhere you like, but the kitchen is closed for the night." },
    ]);
  });

  it("reads through a scanned page in the middle of the range", () => {
    const pageOne = positionedPage(1, [
      line(96, [ACTION_X, "INT. DINER - NIGHT"]),
      line(120, [ACTION_X, "Maya locks the door."]),
    ]);
    const scanned = positionedPage(2, []);
    const pageThree = positionedPage(3, [line(96, [ACTION_X, "EXT. PARKING LOT - NIGHT"])]);

    expect(scanned.lines).toEqual([]);
    expect(classify([pageOne, scanned, pageThree])).toEqual([
      { type: "heading", text: "INT. DINER - NIGHT" },
      { type: "action", text: "Maya locks the door." },
      { type: "heading", text: "EXT. PARKING LOT - NIGHT" },
    ]);
  });
});

describe("column zones", () => {
  it("reads a shot at the action margin, a centered line and a right-hand transition", () => {
    const page = positionedPage(1, [
      line(120, [ACTION_X, "INSERT - THE BROKEN WATCH"]),
      line(168, [280.8, "THE END"]),
      line(216, [TRANSITION_X, "CUT TO:"]),
    ]);

    expect(classify([page])).toEqual([
      { type: "shot", text: "INSERT - THE BROKEN WATCH" },
      { type: "centered", text: "THE END" },
      { type: "transition", text: "CUT TO:" },
    ]);
  });
});

describe("estimating the action margin", () => {
  it("takes the most common left edge of long lines, past any scene number", () => {
    const page = positionedPage(1, [
      line(120, [72, "12."], [ACTION_X, "Rain hammers the windows of the empty diner tonight."]),
      line(144, [ACTION_X, "Maya wipes the counter in slow circles and waits for dawn."]),
      line(180, [DIALOGUE_X, "He can hear the rain on the roof of the car outside now."]),
    ]);

    expect(estimateActionMargin([page])).toBe(ACTION_X);
  });

  it("has nothing to go on until a line is long enough to be action", () => {
    const page = positionedPage(1, [line(120, [ACTION_X, "INT. VAN - DAY"]), line(144, [ACTION_X, "He waits."])]);

    expect(estimateActionMargin([page])).toBeNull();
    expect(estimateActionMargin([])).toBeNull();
    expect(estimateActionMargin(null)).toBeNull();
  });

  it("prefers the leftmost edge when two are equally common, whichever was seen first", () => {
    const page = positionedPage(1, [
      line(120, [ACTION_X, "Maya wipes the counter in slow circles and waits for dawn."]),
      line(144, [72, "Wind pushes rain sideways across the empty highway again."]),
      line(168, [ACTION_X, "Rain hammers the windows of the empty diner tonight."]),
      line(192, [72, "Wind pushes rain sideways across the empty highway once more."]),
    ]);

    expect(estimateActionMargin([page])).toBe(72);
  });
});
