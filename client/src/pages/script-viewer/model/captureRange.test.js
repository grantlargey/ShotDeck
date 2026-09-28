import { describe, expect, it } from "vitest";
import {
  marginShiftPage,
  page1,
  page2,
  page3,
  positionedPage,
  scriptLocation,
  SCRIPT_PAGES,
  textIndexFrom,
} from "../test/textIndexFixtures.js";
import { captureAnchoredRange } from "./captureRange.js";

/*
 * The capture-or-reason interface. Every case asserts the whole result, because
 * the point of the module is that a capture and a reason can never disagree:
 * exactly one of them is set, and nothing else derives the other.
 */

const FULL_INDEX = textIndexFrom(SCRIPT_PAGES, { complete: true });
const P1_RANGE = scriptLocation(page1, 0, page1, 4);
const CROSS_PAGE_RANGE = scriptLocation(page1, 0, page3, 3);
const DINER = "INT. DINER - NIGHT";

/** A page the index holds but the layout reads as nothing: furniture only. */
const furniturePage = positionedPage(7, [
  { x: 300, y: 80, text: "7." },
  { x: 432, y: 744, text: "(CONTINUED)" },
]);

describe("captured text", () => {
  it("captures the text between two anchors, keyed to the pair", () => {
    const captured = captureAnchoredRange(FULL_INDEX, P1_RANGE);

    expect(captured.unavailable).toBeNull();
    expect(captured.capture).toEqual({
      key: "1:96-1:168",
      markdown: expect.stringContaining(`## ${DINER}`),
      plainText: expect.stringContaining(DINER),
      pageStart: 1,
      pageEnd: 1,
    });
  });

  it("stops at the anchored lines instead of capturing their whole pages", () => {
    const captured = captureAnchoredRange(FULL_INDEX, scriptLocation(page1, 5, page2, 0));

    expect(captured.capture.plainText).toBe("MAYA\n\nKitchen closed an hour ago. Coffee is all I can do.\n\nSAM");
    expect(captured.capture).toMatchObject({ pageStart: 1, pageEnd: 2 });
  });
});

describe("why there is no captured text", () => {
  it.each([
    ["no anchors at all", null, "start"],
    ["no start anchor", { start: null, end: P1_RANGE.end }, "start"],
    ["no end anchor", { start: P1_RANGE.start, end: null }, "end"],
  ])("reports the anchor still to be placed: %s", (_, anchors, reason) => {
    expect(captureAnchoredRange(FULL_INDEX, anchors)).toEqual({ capture: null, unavailable: reason });
  });

  it.each([
    ["a page above the contract cap", { end: { page: 301 } }],
    ["a baseline above the contract cap", { end: { y: 1000.1 } }],
    ["a negative baseline", { end: { y: -1 } }],
    ["non-finite geometry", { end: { y: Number.NaN } }],
    ["an end anchor before its start", { start: { page: 3, y: 144 }, end: { page: 3, y: 96 } }],
  ])("reports a location the script location contract rejects as unreadable: %s", (_, changes) => {
    const valid = scriptLocation(page3, 0, page3, 4);
    const invalid = { start: { ...valid.start, ...changes.start }, end: { ...valid.end, ...changes.end } };

    expect(captureAnchoredRange(FULL_INDEX, invalid)).toEqual({ capture: null, unavailable: "unreadable" });
  });

  it("waits while a page in the range is still to be indexed, then captures it", () => {
    expect(captureAnchoredRange(textIndexFrom([page1, page3]), CROSS_PAGE_RANGE)).toEqual({
      capture: null,
      unavailable: "indexing",
    });

    const captured = captureAnchoredRange(textIndexFrom([page1, page2, page3]), CROSS_PAGE_RANGE);
    expect(captured.unavailable).toBeNull();
    expect(captured.capture).toMatchObject({ pageStart: 1, pageEnd: 3 });
  });

  it("calls a range page the finished index never published unreadable: it is a scan", () => {
    expect(captureAnchoredRange(textIndexFrom([page1, page3], { complete: true }), CROSS_PAGE_RANGE)).toEqual({
      capture: null,
      unavailable: "unreadable",
    });
  });

  it("reports unreadable when an anchor's baseline has no line under it", () => {
    const blankPage = positionedPage(5, []);
    const anchor = { page: 5, y: 96 };

    expect(captureAnchoredRange(textIndexFrom([blankPage], { complete: true }), { start: anchor, end: anchor })).toEqual(
      { capture: null, unavailable: "unreadable" }
    );
  });

  it("reports unreadable when every line in the range is an artifact the layout strips", () => {
    const index = textIndexFrom([furniturePage], { complete: true });

    // Both lines are indexed, so the anchors resolve; neither survives layout.
    expect(furniturePage.lines).toHaveLength(2);
    expect(captureAnchoredRange(index, scriptLocation(furniturePage, 0, furniturePage, 1))).toEqual({
      capture: null,
      unavailable: "unreadable",
    });
  });
});

describe("the action margin in effect", () => {
  it("classifies the same anchors differently as indexing moves the document margin", () => {
    const range = scriptLocation(page1, 0, page2, 3);
    const early = captureAnchoredRange(textIndexFrom([page1, page2]), range);
    const shifted = captureAnchoredRange(textIndexFrom([page1, page2, page3, marginShiftPage]), range);

    expect(shifted.capture.key).toBe(early.capture.key);
    expect(shifted.capture.markdown).not.toBe(early.capture.markdown);
  });

  it("still captures when no page has a line long enough to estimate a margin", () => {
    const shortPage = positionedPage(9, [
      { x: 108, y: 96, text: "INT. VAN - DAY" },
      { x: 108, y: 120, text: "He waits." },
    ]);
    const index = textIndexFrom([shortPage], { complete: true });

    expect(index.actionMargin).toBeNull();
    expect(captureAnchoredRange(index, scriptLocation(shortPage, 0, shortPage, 1)).capture.markdown).toBe(
      "## INT. VAN - DAY\n\nHe waits."
    );
  });
});
