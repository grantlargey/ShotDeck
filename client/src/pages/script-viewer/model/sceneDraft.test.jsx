import { act, render, renderHook } from "@testing-library/react";
import { Component, StrictMode, useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  marginShiftPage,
  OTHER_TEXT,
  otherScene,
  page1,
  page2,
  page3,
  positionedPage,
  SAVED_RAW,
  SAVED_TEXT,
  savedScene,
  sceneRow,
  SCRIPT_PAGES,
  scriptLocation,
  textIndexFrom,
} from "../test/textIndexFixtures.js";
import { captureAnchoredRange } from "./captureRange.js";
import { useSceneDraft } from "./sceneDraft.js";

vi.mock("./captureRange.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, captureAnchoredRange: vi.fn(actual.captureAnchoredRange) };
});

const FULL_INDEX = textIndexFrom(SCRIPT_PAGES, { complete: true });
const NO_OTHER_SCENES = { runtimeSeconds: 0, scenes: [] };
const DINER = "INT. DINER - NIGHT";
const RAIN =
  "Rain streaks the windows of an empty roadside diner at midnight. MAYA, thirties, wipes the counter in slow circles.";
const BELL = "A bell over the door rings. SAM steps in from the storm, shaking water from a battered canvas coat and hat.";
const P1_SHORT_MARKDOWN = [`## ${DINER}`, RAIN, BELL].join("\n\n");

function renderDraft(index = FULL_INDEX, options = {}) {
  return renderHook(({ currentIndex }) => useSceneDraft(currentIndex), {
    initialProps: { currentIndex: index },
    ...options,
  });
}

function view(result) {
  const [draft, actions] = result.current;
  return { draft, actions };
}

function capturedEditorKey(revision, anchorPair) {
  return expect.stringMatching(new RegExp(`^${revision}:${anchorPair}#[0-9a-z]+\\.[0-9a-z]+$`));
}

function run(result, callback) {
  let answer;
  act(() => {
    answer = callback(view(result).actions);
  });
  return answer;
}

function place(result, kind, page, line) {
  run(result, (actions) => actions.setAnchorAtLine(kind, page.pageNumber, page.lines[line]));
}

function setTiming(result, start = "00:01:00", end = "00:02:00") {
  run(result, (actions) => actions.setTime("startTime", start));
  run(result, (actions) => actions.setTime("endTime", end));
}

function save(result, options = NO_OTHER_SCENES) {
  return run(result, (actions) => actions.buildSave(options));
}

function acceptProposal(result, markdown) {
  const request = run(result, (actions) => actions.startProposal());
  run(result, (actions) => actions.proposalReady(request.token, markdown));
  run(result, (actions) => actions.acceptProposal());
  return request;
}

function DraftProbe({ index, discard, onActions }) {
  const [, actions] = useSceneDraft(index);
  useLayoutEffect(() => onActions(actions));
  if (discard) throw new Error("This render is discarded.");
  return null;
}

class DiscardBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

beforeEach(() => {
  captureAnchoredRange.mockClear();
});

describe("committed view and stable interface", () => {
  it("lets actions in one batch read only the view committed before the batch", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);

    let request;
    act(() => {
      const { actions } = view(result);
      actions.setAnchorAtLine("end", 1, page1.lines[4]);
      request = actions.startProposal();
    });

    expect(request.snapshotAnchors.end).toMatchObject({ page: 1, y: 216 });
    expect(request.capturedText).toContain("Coffee is all I can do.");
    expect(view(result).draft.anchors.end).toMatchObject({ page: 1, y: 168 });
  });

  it("builds from committed timing and normalizes only after the field commits", () => {
    const { result } = renderDraft();
    let pendingSave;
    act(() => {
      const { actions } = view(result);
      actions.setTime("startTime", "1:05");
      actions.normalizeTime("startTime");
      pendingSave = actions.buildSave(NO_OTHER_SCENES);
    });
    expect(pendingSave).toEqual({ error: "Enter a start and an end time for this scene." });
    expect(view(result).draft.startTime).toBe("1:05");
    run(result, (actions) => actions.normalizeTime("startTime"));
    expect(view(result).draft.startTime).toBe("00:01:05");
  });

  it("never exposes actions from an abandoned concurrent render", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let actions;
    const tree = (index, discard) => (
      <DiscardBoundary>
        <DraftProbe index={index} discard={discard} onActions={(next) => (actions = next)} />
      </DiscardBoundary>
    );
    const rendered = render(tree(textIndexFrom([]), false));
    act(() => actions.loadScene(savedScene));
    rendered.rerender(tree(FULL_INDEX, true));

    let request;
    act(() => {
      request = actions.startProposal();
    });
    expect(request.snapshotAnchors).toBeNull();
    expect(request.capturedText).toBe("EXT. PARKING LOT - NIGHT\n\nA truck idles in the lot while someone watches the diner.");
    consoleError.mockRestore();
  });

  it("keeps action, anchor, preview and proposal identities when their inputs do not change", () => {
    const { result, rerender } = renderDraft();
    const actions = view(result).actions;
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    run(result, (next) => next.editText("## EDITED\n\nText."));
    const request = run(result, (next) => next.startProposal());
    const before = view(result).draft;
    rerender({ currentIndex: FULL_INDEX });
    expect(view(result).actions).toBe(actions);
    expect(view(result).draft.anchors).toBe(before.anchors);
    expect(view(result).draft.previewScene).toBe(before.previewScene);
    expect(view(result).draft.proposal).toBe(before.proposal);
    expect(Object.keys(before.proposal).sort()).toEqual(["capturedPlainText", "error", "markdown", "status"]);
    run(result, (next) => next.proposalReady(request.token, "## AI"));
  });

  it("does not recapture for unrelated draft edits but does for anchor and index changes", () => {
    const { result, rerender } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    const calls = captureAnchoredRange.mock.calls.length;
    run(result, (actions) => actions.setTime("startTime", "1:00"));
    run(result, (actions) => actions.toggleTag("tone:dread"));
    run(result, (actions) => actions.editText("## EDITED\n\nText."));
    const request = run(result, (actions) => actions.startProposal());
    run(result, (actions) => actions.proposalFailed(request.token, "failed"));
    expect(captureAnchoredRange.mock.calls.length).toBe(calls);
    place(result, "end", page1, 4);
    expect(captureAnchoredRange.mock.calls.length).toBeGreaterThan(calls);
    const afterAnchor = captureAnchoredRange.mock.calls.length;
    rerender({ currentIndex: textIndexFrom([page1]) });
    expect(captureAnchoredRange.mock.calls.length).toBeGreaterThan(afterAnchor);
  });
});

describe("capture and canonical save contract", () => {
  it("captures a complete anchor pair and emits only canonical fields", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 4);
    setTiming(result);
    run(result, (actions) => actions.toggleTag("tone:dread"));

    const { payload, confirmStaleText } = save(result);
    expect(payload).toEqual({
      start_time_seconds: 60,
      end_time_seconds: 120,
      script_location: scriptLocation(page1, 0, page1, 4),
      scene_text: P1_SHORT_MARKDOWN,
      tags: ["tone:dread"],
    });
    expect(confirmStaleText).toBe(false);
    expect(Object.keys(payload).sort()).toEqual([
      "end_time_seconds",
      "scene_text",
      "script_location",
      "start_time_seconds",
      "tags",
    ]);
  });

  it("refuses incomplete anchors and waits for an unfinished range", () => {
    const { result } = renderDraft(textIndexFrom([page1, page3]));
    setTiming(result);
    expect(save(result)).toEqual({ error: "Place a start anchor in the script before saving." });

    place(result, "start", page1, 0);
    expect(save(result)).toEqual({ error: "Place an end anchor in the script before saving." });

    place(result, "end", page3, 0);
    expect(save(result)).toEqual({
      error: "Wait for the pages between the anchors to finish indexing, then save again.",
    });

    const third = renderDraft(textIndexFrom([], { complete: true }));
    setTiming(third.result);
    // No indexed line can be placed, so the draft remains incomplete.
    expect(save(third.result)).toEqual({ error: "Place a start anchor in the script before saving." });
  });

  it("reports unreadable after indexing finishes without a required range page", () => {
    const { result } = renderDraft(textIndexFrom([page1], { complete: true }));
    run(result, (actions) =>
      actions.loadScene(
        sceneRow({
          id: "missing-page",
          script_location: scriptLocation(page1, 0, page2, 3),
          scene_text: "## SAVED\n\nText.",
        })
      )
    );
    expect(save(result)).toEqual({
      error: "The script text between the anchors can't be read. Move the anchors to lines with text, then save again.",
    });
  });

  it("reports unreadable when an indexed anchor page has no resolvable lines", () => {
    const emptyPage = positionedPage(5, []);
    const emptyAnchor = { page: 5, y: 96 };
    const { result } = renderDraft(textIndexFrom([emptyPage], { complete: true }));
    run(result, (actions) =>
      actions.loadScene(
        sceneRow({
          id: "empty-page",
          script_location: { start: emptyAnchor, end: emptyAnchor },
          scene_text: "## SAVED\n\nText.",
        })
      )
    );
    expect(save(result)).toEqual({
      error: "The script text between the anchors can't be read. Move the anchors to lines with text, then save again.",
    });
  });

  it.each([
    ["page above the contract cap", { end: { page: 301 } }],
    ["a baseline above the contract cap", { end: { y: 1000.1 } }],
    ["a negative baseline", { end: { y: -1 } }],
    ["non-finite geometry", { end: { y: Number.NaN } }],
    ["reversed anchors", { start: { page: 3, y: 144 }, end: { page: 3, y: 96 } }],
  ])("refuses capture for a location with %s", (_, changes) => {
    const valid = scriptLocation(page3, 0, page3, 4);
    const invalid = {
      start: { ...valid.start, ...changes.start },
      end: { ...valid.end, ...changes.end },
    };
    expect(captureAnchoredRange(FULL_INDEX, invalid)).toEqual({ capture: null, unavailable: "unreadable" });
  });

  it("carries the reason the anchors capture nothing on the draft the panel reads", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1, page3]));
    expect(view(result).draft.captureUnavailable).toBe("start");

    place(result, "start", page1, 0);
    expect(view(result).draft.captureUnavailable).toBe("end");

    place(result, "end", page3, 0);
    expect(view(result).draft.captureUnavailable).toBe("indexing");

    // The missing page is a scan: indexing finishes without ever publishing it.
    rerender({ currentIndex: textIndexFrom([page1, page3], { complete: true }) });
    expect(view(result).draft).toMatchObject({ captureUnavailable: "unreadable", text: "" });

    rerender({ currentIndex: FULL_INDEX });
    expect(view(result).draft.captureUnavailable).toBeNull();
    expect(view(result).draft.text).toContain(DINER);
  });

  it("rejects a complete range when layout filtering leaves no usable raw text", () => {
    const artifactPage = positionedPage(7, [{ x: 108, y: 20, text: "7" }]);
    const { result } = renderDraft(textIndexFrom([artifactPage], { complete: true }));
    run(result, (actions) =>
      actions.loadScene(
        sceneRow({
          id: "artifact-only",
          script_location: scriptLocation(artifactPage, 0, artifactPage, 0),
          scene_text: "## SAVED SCENE",
        })
      )
    );

    expect(view(result).draft.text).toBe("## SAVED SCENE");
    expect(save(result)).toEqual({
      error: "The script text between the anchors can't be read. Move the anchors to lines with text, then save again.",
    });
  });

  it("waits only for pages in the anchored range and then saves before the full script is indexed", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1, page3]));
    place(result, "start", page1, 0);
    place(result, "end", page3, 3);
    setTiming(result);
    expect(save(result)).toEqual({
      error: "Wait for the pages between the anchors to finish indexing, then save again.",
    });

    rerender({ currentIndex: textIndexFrom([page1, page2, page3]) });
    expect(save(result).payload.script_location).toEqual(scriptLocation(page1, 0, page3, 3));
  });

  it("keeps an edited scene text while raw text follows the current capture", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 4);
    setTiming(result);
    run(result, (actions) => actions.editText("## EDITED\n\nHand-written text."));

    expect(save(result)).toMatchObject({
      confirmStaleText: false,
      payload: { scene_text: "## EDITED\n\nHand-written text." },
    });
  });
});

describe("anchors, indexing and editor identity", () => {
  it("clearing all anchors makes a saved draft unsaveable until undo restores them", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    expect(view(result).draft.dirty).toBe(false);

    run(result, (actions) => actions.clearAnchors());
    expect(view(result).draft).toMatchObject({ anchors: { start: null, end: null }, dirty: true });
    expect(save(result)).toEqual({ error: "Place a start anchor in the script before saving." });

    run(result, (actions) => actions.undoAnchors());
    expect(view(result).draft.anchors).toEqual(savedScene.script_location);
    expect(save(result).payload.script_location).toEqual(savedScene.script_location);
  });

  it("swaps anchors to keep the location ordered and records undo history", () => {
    const { result } = renderDraft();
    place(result, "start", page2, 3);
    place(result, "end", page1, 0);
    expect(view(result).draft.anchors).toEqual(scriptLocation(page1, 0, page2, 3));
    expect(view(result).draft.canUndoAnchors).toBe(true);
    run(result, (actions) => actions.undoAnchors());
    expect(view(result).draft.anchors).toMatchObject({ start: expect.objectContaining({ page: 2, y: 132 }), end: null });
  });

  it("keeps the editor identity when an index update leaves captured text unchanged", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1, page2]));
    place(result, "start", page1, 0);
    place(result, "end", page2, 3);
    const before = view(result).draft;

    rerender({ currentIndex: textIndexFrom([page1, page2, page3], { complete: true }) });
    expect(view(result).draft.editorKey).toBe(before.editorKey);
    expect(view(result).draft.text).toBe(before.text);
  });

  it("replaces captured text and editor identity when indexing changes layout classification", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1, page2]));
    place(result, "start", page1, 0);
    place(result, "end", page2, 3);
    const before = view(result).draft;

    rerender({ currentIndex: textIndexFrom([page1, page2, page3, marginShiftPage]) });
    expect(view(result).draft.editorKey).not.toBe(before.editorKey);
    expect(view(result).draft.text).not.toBe(before.text);
  });

  it("preserves edited text across later index updates", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1, page2]));
    place(result, "start", page1, 0);
    place(result, "end", page2, 3);
    run(result, (actions) => actions.editText("## EDITED\n\nKeep this."));
    const key = view(result).draft.editorKey;

    rerender({ currentIndex: textIndexFrom([page1, page2, page3, marginShiftPage], { complete: true }) });
    expect(view(result).draft).toMatchObject({ text: "## EDITED\n\nKeep this.", editorKey: key, textOrigin: "edited" });
  });
});

describe("index publication and proposal races", () => {
  const PARTIAL = textIndexFrom([page1, page2]);
  const SHIFTED = textIndexFrom([page1, page2, page3, marginShiftPage]);
  const AI_TEXT = "## AI HEADING\n\nWords from the formatter.";

  function anchorAcrossPages(result) {
    place(result, "start", page1, 0);
    place(result, "end", page2, 3);
    setTiming(result);
  }

  it.each([
    ["after the first edit commits", false],
    ["in the same React batch as the first edit", true],
  ])("keeps edited text when capture reclassification publishes %s", (_, sameBatch) => {
    const { result, rerender } = renderDraft(PARTIAL);
    anchorAcrossPages(result);
    const before = view(result).draft;
    const edited = before.text.replace(`## ${DINER}`, "## INT. DINER - LATE NIGHT");

    if (sameBatch) {
      act(() => {
        view(result).actions.editText(edited);
        rerender({ currentIndex: SHIFTED });
      });
    } else {
      run(result, (actions) => actions.editText(edited));
      rerender({ currentIndex: SHIFTED });
    }

    expect(view(result).draft).toMatchObject({
      text: edited,
      textOrigin: "edited",
      textStale: false,
      editorKey: before.editorKey,
      recaptureOption: "revert",
    });
    expect(save(result)).toMatchObject({
      confirmStaleText: false,
      payload: { scene_text: edited },
    });
    run(result, (actions) => actions.recapture());
    expect(view(result).draft).toMatchObject({
      textOrigin: "capture",
      recaptureOption: "none",
      editorKey: capturedEditorKey(1, "1:96-2:132"),
    });
  });

  it("keeps accepted AI text and a pending request's capture baseline during reclassification", () => {
    const { result, rerender } = renderDraft(PARTIAL);
    anchorAcrossPages(result);
    const requestedPlainText = view(result).draft.capturedPlainText;
    acceptProposal(result, AI_TEXT);
    const editorKey = view(result).draft.editorKey;
    const request = run(result, (actions) => actions.startProposal());

    rerender({ currentIndex: SHIFTED });
    expect(view(result).draft).toMatchObject({ text: AI_TEXT, textOrigin: "ai", textStale: false, editorKey });
    expect(view(result).draft.capturedPlainText).not.toBe(requestedPlainText);
    expect(view(result).draft.proposal.capturedPlainText).toBe(requestedPlainText);

    run(result, (actions) => actions.proposalReady(request.token, "## SECOND AI\n\nMore words."));
    run(result, (actions) => actions.acceptProposal());
    expect(save(result)).toMatchObject({
      confirmStaleText: false,
      payload: { scene_text: "## SECOND AI\n\nMore words." },
    });
  });

  it("allocates proposal tokens once under StrictMode and ignores superseded, discarded and previous-draft results", () => {
    const { result } = renderDraft(FULL_INDEX, { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
    expect(run(result, (actions) => actions.startProposal())).toBeNull();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    const first = run(result, (actions) => actions.startProposal());
    const second = run(result, (actions) => actions.startProposal());
    expect([first.token, second.token]).toEqual([1, 2]);
    run(result, (actions) => actions.proposalReady(first.token, "## OLD"));
    expect(view(result).draft.proposal.status).toBe("loading");
    run(result, (actions) => actions.proposalReady(second.token, "## NEW"));
    expect(view(result).draft.proposal).toMatchObject({ status: "ready", markdown: "## NEW" });
    run(result, (actions) => actions.discardProposal());
    run(result, (actions) => actions.proposalReady(second.token, "## AFTER DISCARD"));
    expect(view(result).draft.proposal).toBeNull();
    const third = run(result, (actions) => actions.startProposal());
    run(result, (actions) => actions.loadScene(savedScene));
    run(result, (actions) => actions.proposalFailed(third.token, "too late"));
    expect(view(result).draft.proposal).toBeNull();
  });

  it("keeps canonical saved-scene proposal provenance when indexing appears after the request", () => {
    const { result, rerender } = renderDraft(textIndexFrom([]));
    run(result, (actions) => actions.loadScene(savedScene));
    const request = run(result, (actions) => actions.startProposal());
    expect(request).toMatchObject({
      capturedText: SAVED_RAW,
      draftMarkdown: SAVED_TEXT,
      pageStart: 3,
      pageEnd: 3,
      snapshotAnchors: null,
    });
    run(result, (actions) => actions.proposalReady(request.token, AI_TEXT));
    rerender({ currentIndex: FULL_INDEX });
    expect(view(result).draft.proposal.capturedPlainText).toBe("");
    run(result, (actions) => actions.acceptProposal());
    expect(view(result).draft).toMatchObject({ textOrigin: "ai", textStale: false, recaptureOption: "revert" });
  });
});

describe("stale text", () => {
  it.each([
    ["saved", () => {}],
    ["edited", (result) => run(result, (actions) => actions.editText("## EDITED\n\nText."))],
    ["AI", (result) => acceptProposal(result, "## AI\n\nText.")],
  ])("requires confirmation when %s text belongs to the previous anchors", (_, changeText) => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    changeText(result);
    place(result, "end", page3, 4);

    expect(view(result).draft.textStale).toBe(true);
    expect(save(result)).toMatchObject({
      confirmStaleText: true,
      payload: { script_location: scriptLocation(page3, 0, page3, 4) },
    });
  });

  it("stops requiring confirmation when anchors return to the text's pair", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    place(result, "end", page3, 4);
    expect(save(result).confirmStaleText).toBe(true);
    run(result, (actions) => actions.undoAnchors());
    expect(save(result).confirmStaleText).toBe(false);
  });

  it("re-capture replaces stale text with the current anchored capture", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    place(result, "end", page3, 4);
    run(result, (actions) => actions.recapture());
    expect(view(result).draft).toMatchObject({ textOrigin: "capture", textStale: false, recaptureOption: "none" });
    expect(save(result).confirmStaleText).toBe(false);
  });
});

describe("re-capture, editor identity and anchor history", () => {
  it.each([
    ["fresh edited", "edited", false, "revert", true],
    ["stale edited", "edited", true, "recapture", true],
    ["fresh AI", "ai", false, "revert", true],
    ["stale AI", "ai", true, "recapture", true],
    ["stale saved", "saved", true, "recapture", false],
  ])("derives the re-capture contract for %s text", (_, origin, stale, option, replaces) => {
    const { result } = renderDraft();
    if (origin === "saved") {
      run(result, (actions) => actions.loadScene(savedScene));
    } else {
      place(result, "start", page1, 0);
      place(result, "end", page1, 7);
      if (origin === "edited") run(result, (actions) => actions.editText("## EDITED\n\nText."));
      else acceptProposal(result, "## AI\n\nText.");
    }
    if (stale) {
      if (origin === "saved") place(result, "end", page3, 4);
      else place(result, "end", page1, 4);
    }

    const before = view(result).draft;
    expect(before).toMatchObject({
      textOrigin: origin,
      textStale: stale,
      recaptureOption: option,
      recaptureReplacesEdits: replaces,
    });
    run(result, (actions) => actions.recapture());
    expect(view(result).draft).toMatchObject({ textOrigin: "capture", textStale: false, recaptureOption: "none" });
    expect(view(result).draft.editorKey).not.toBe(before.editorKey);
  });

  it("keeps an editor key through edits and anchor movement, then replaces it for re-capture, AI, load and reset", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    const captured = view(result).draft.editorKey;
    expect(captured).toEqual(capturedEditorKey(0, "1:96-1:216"));
    run(result, (actions) => actions.editText("## EDITED\n\nText."));
    place(result, "end", page1, 4);
    expect(view(result).draft.editorKey).toBe(captured);
    run(result, (actions) => actions.recapture());
    expect(view(result).draft.editorKey).toEqual(capturedEditorKey(1, "1:96-1:168"));
    acceptProposal(result, "## AI\n\nText.");
    expect(view(result).draft.editorKey).toBe("2:1:96-1:168");
    run(result, (actions) => actions.loadScene(savedScene));
    expect(view(result).draft.editorKey).toBe("3:3:96-3:156");
    run(result, (actions) => actions.reset());
    expect(view(result).draft.editorKey).toBe("4:");
  });

  it("caps undo history at 50 distinct anchor states and ignores same-line placement", () => {
    const { result } = renderDraft();
    for (let placement = 1; placement <= 60; placement += 1) {
      place(result, "start", page1, placement % 2);
    }
    for (let undo = 1; undo <= 50; undo += 1) run(result, (actions) => actions.undoAnchors());
    expect(view(result).draft.canUndoAnchors).toBe(false);
    expect(view(result).draft.anchors.start).toMatchObject({ page: 1, y: 96 });

    const second = renderDraft();
    place(second.result, "start", page1, 0);
    place(second.result, "start", page1, 0);
    run(second.result, (actions) => actions.undoAnchors());
    expect(view(second.result).draft).toMatchObject({ anchors: { start: null, end: null }, canUndoAnchors: false });
  });
});

describe("AI proposal provenance", () => {
  it("returns the canonical selection context without mutating the draft", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const before = view(result).draft;
    const request = run(result, (actions) => actions.startProposal());

    expect(request).toMatchObject({
      capturedText: expect.stringContaining("EXT. PARKING LOT"),
      draftMarkdown: SAVED_TEXT,
      pageStart: 3,
      pageEnd: 3,
      snapshotAnchors: savedScene.script_location,
    });
    expect(view(result).draft.text).toBe(before.text);
    expect(view(result).draft.proposal.status).toBe("loading");
  });

  it("keeps a proposal's requested selection when anchors are cleared without making the draft saveable", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const request = run(result, (actions) => actions.startProposal());
    run(result, (actions) => actions.clearAnchors());
    run(result, (actions) => actions.proposalReady(request.token, "## AI\n\nProposal."));
    run(result, (actions) => actions.acceptProposal());

    expect(request.snapshotAnchors).toEqual(savedScene.script_location);
    expect(view(result).draft).toMatchObject({
      anchors: { start: null, end: null },
      textOrigin: "ai",
      text: "## AI\n\nProposal.",
    });
    expect(save(result)).toEqual({ error: "Place a start anchor in the script before saving." });
  });

  it("ignores superseded responses and supports failure and dismissal", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const first = run(result, (actions) => actions.startProposal());
    const second = run(result, (actions) => actions.startProposal());
    run(result, (actions) => actions.proposalReady(first.token, "## OLD"));
    expect(view(result).draft.proposal.status).toBe("loading");
    run(result, (actions) => actions.proposalFailed(second.token, "Formatter unavailable."));
    expect(view(result).draft.proposal).toMatchObject({ status: "error", error: "Formatter unavailable." });
    run(result, (actions) => actions.discardProposal());
    expect(view(result).draft.proposal).toBeNull();
  });
});

describe("persistence races", () => {
  it("applies an unchanged save as the new baseline", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    run(result, (actions) => actions.editText("## EDITED\n\nSaved."));
    const pending = save(result);
    const response = sceneRow({ ...savedScene, ...pending.payload, updated_at: "later" });
    act(() => pending.applySaved(response));

    expect(view(result).draft).toMatchObject({ savedScene: response, text: response.scene_text, dirty: false });
  });

  it("keeps edits made while a save is pending and acknowledges the returned id", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 4);
    setTiming(result);
    const pending = save(result);
    run(result, (actions) => actions.editText("## NEWER\n\nNot in the response."));
    const response = sceneRow({ id: "created", ...pending.payload });
    act(() => pending.applySaved(response));

    expect(view(result).draft).toMatchObject({ text: "## NEWER\n\nNot in the response.", savedScene: response, dirty: true });
    expect(save(result).payload.scene_text).toBe("## NEWER\n\nNot in the response.");
  });

  it("preserves an edit queued before the save response in the same React batch", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const pending = save(result);
    const response = sceneRow({ ...savedScene, ...pending.payload });
    act(() => {
      view(result).actions.setTime("endTime", "00:11:30");
      pending.applySaved(response);
    });
    expect(view(result).draft).toMatchObject({ savedScene: response, endTime: "00:11:30", dirty: true });
  });

  it("ignores a save response after reset even when both are queued in the same React batch", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const pending = save(result);
    act(() => {
      view(result).actions.reset();
      pending.applySaved(sceneRow({ ...savedScene, ...pending.payload }));
    });
    expect(view(result).draft).toMatchObject({ savedScene: null, text: "", dirty: false });
  });

  it("ignores a save response after another scene loads", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const pending = save(result);
    run(result, (actions) => actions.loadScene(otherScene));
    act(() => pending.applySaved({ ...savedScene, ...pending.payload }));
    expect(view(result).draft.savedScene.id).toBe(otherScene.id);
    expect(view(result).draft.text).toBe(OTHER_TEXT);
  });

  it("preserves newer edits as a new draft when delete completes", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const complete = run(result, (actions) => actions.prepareDelete(savedScene.id));
    run(result, (actions) => actions.editText("## KEEP\n\nThis work."));
    act(() => complete());

    expect(view(result).draft).toMatchObject({ savedScene: null, textOrigin: "edited", text: "## KEEP\n\nThis work.", dirty: true });
  });

  it("deletion detaches newer edits and invalidates an older pending save in the same batch", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const pendingSave = save(result);
    const completeDelete = run(result, (actions) => actions.prepareDelete(savedScene.id));
    act(() => {
      view(result).actions.editText("## UNSAVED\n\nKeep this text.");
      completeDelete();
      pendingSave.applySaved(sceneRow({ ...savedScene, ...pendingSave.payload }));
    });
    expect(view(result).draft).toMatchObject({
      savedScene: null,
      textOrigin: "edited",
      text: "## UNSAVED\n\nKeep this text.",
      dirty: true,
    });
  });

  it("leaves a different draft alone when an earlier delete completes", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    const complete = run(result, (actions) => actions.prepareDelete(savedScene.id));
    run(result, (actions) => actions.loadScene(otherScene));
    act(() => complete());
    expect(view(result).draft.savedScene.id).toBe(otherScene.id);
  });
});

describe("preview and overlap", () => {
  it("uses the stored-scene shape for the draft preview", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page2, 3);
    setTiming(result);
    expect(view(result).draft.previewScene).toEqual({
      start_time_seconds: 60,
      end_time_seconds: 120,
      script_location: scriptLocation(page1, 0, page2, 3),
      tags: [],
      scene_text: expect.any(String),
    });
  });

  it("refuses a script-location overlap but excludes the draft's own saved row", () => {
    const { result } = renderDraft();
    run(result, (actions) => actions.loadScene(savedScene));
    expect(save(result, { runtimeSeconds: 0, scenes: [savedScene] }).payload).toBeTruthy();

    place(result, "start", page2, 0);
    place(result, "end", page2, 3);
    expect(save(result, { runtimeSeconds: 0, scenes: [savedScene, otherScene] })).toEqual({
      error: "These anchors share lines with the scene at 00:05:00 – 00:06:00. Move the anchors so the scenes don't overlap.",
    });
  });
});
