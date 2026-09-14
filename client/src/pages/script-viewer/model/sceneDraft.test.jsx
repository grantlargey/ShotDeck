import { act, render, renderHook } from "@testing-library/react";
import { Component, StrictMode, useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_RAW,
  legacyScene,
  OTHER_TEXT,
  otherScene,
  page1,
  page2,
  page3,
  positionedPage,
  SAVED_V2_TEXT,
  savedV2Scene,
  sceneRow,
  SCRIPT_PAGES,
  textIndexFrom,
  v2Geometry,
} from "../test/textIndexFixtures.js";
import { captureAnchoredRange } from "./captureRange.js";
import { useSceneDraft } from "./sceneDraft.js";

/*
 * Interface tests for useSceneDraft, covering what the page characterization
 * suite can't reach or pin precisely: the committed-view contract, identities,
 * capture work, request tokens, and exact save mapping.
 */

// A passthrough spy: capture runs for real; tests only count calls.
vi.mock("./captureRange.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, captureAnchoredRange: vi.fn(actual.captureAnchoredRange) };
});

const FULL_INDEX = textIndexFrom(SCRIPT_PAGES, { total: 3, complete: true });

const DINER = "INT. DINER - NIGHT";
const RAIN =
  "Rain streaks the windows of an empty roadside diner at midnight. MAYA, thirties, wipes the counter in slow circles.";
const BELL = "A bell over the door rings. SAM steps in from the storm, shaking water from a battered canvas coat and hat.";
const MAYA_SPEECH = "Kitchen closed an hour ago. Coffee is all I can do.";
/** Captured plain text for p1 lines 1–8, and for p1 lines 1–5. */
const P1_PLAIN = [DINER, RAIN, BELL, "MAYA", MAYA_SPEECH].join("\n\n");
const P1_SHORT_PLAIN = [DINER, RAIN, BELL].join("\n\n");

function renderDraft(index = FULL_INDEX, options = {}) {
  return renderHook(({ index: current }) => useSceneDraft(current), { initialProps: { index }, ...options });
}

/** The draft view and actions from the latest commit. */
function current(result) {
  const [draft, actions] = result.current;
  return { draft, actions };
}

function lineOf(page, lineIndex) {
  return page.lines[lineIndex];
}

function place(result, kind, page, lineIndex) {
  act(() => current(result).actions.setAnchorAtLine(kind, page.pageNumber, lineOf(page, lineIndex)));
}

function run(result, step) {
  let value;
  act(() => {
    value = step(current(result).actions);
  });
  return value;
}

function acceptAiText(result, markdown) {
  const request = run(result, (actions) => actions.startProposal());
  run(result, (actions) => actions.proposalReady(request.token, markdown));
  run(result, (actions) => actions.acceptProposal());
}

/** Renders the hook and throws after it when `discard` is set, so React discards that render. */
function DraftProbe({ index, discard, onActions }) {
  const [, draftActions] = useSceneDraft(index);
  useLayoutEffect(() => onActions(draftActions));
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

describe("committed-view contract", () => {
  it("lets every action in one act read the draft committed before it", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);

    let request;
    act(() => {
      const { actions } = current(result);
      actions.setAnchorAtLine("end", 1, lineOf(page1, 4));
      request = actions.startProposal();
    });

    expect(request.snapshotAnchors.end).toMatchObject({ page: 1, line: 7 });
    expect(request.capturedText).toContain(MAYA_SPEECH);
    expect(current(result).draft.anchors.end).toMatchObject({ page: 1, line: 4 });
    expect(current(result).draft.proposal.status).toBe("loading");
  });

  it("builds each payload from the committed anchors, so a second placement in the same act overrides the first", () => {
    const { result } = renderDraft();

    act(() => {
      const { actions } = current(result);
      actions.setAnchorAtLine("start", 1, lineOf(page1, 0));
      actions.setAnchorAtLine("end", 1, lineOf(page1, 7));
    });

    expect(current(result).draft.anchors.start).toBeNull();
    expect(current(result).draft.anchors.end).toMatchObject({ page: 1, line: 7 });
  });

  it("reads committed times for normalizeTime and buildSave", () => {
    const { result } = renderDraft();

    let save;
    act(() => {
      const { actions } = current(result);
      actions.setTime("startTime", "1:05");
      actions.normalizeTime("startTime");
      save = actions.buildSave(0);
    });

    expect(save).toEqual({ error: "Enter a start and an end time for this scene." });
    expect(current(result).draft.startTime).toBe("1:05");
    run(result, (actions) => actions.normalizeTime("startTime"));
    expect(current(result).draft.startTime).toBe("00:01:05");
  });

  it("never lets actions see a render that React discarded", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let actions;
    const keepActions = (value) => {
      actions = value;
    };
    const tree = (index, discard) => (
      <DiscardBoundary>
        <DraftProbe index={index} discard={discard} onActions={keepActions} />
      </DiscardBoundary>
    );
    const { rerender } = render(tree(textIndexFrom([], { total: 3 }), false));
    act(() => actions.loadScene(savedV2Scene));

    // This render has a capture for the saved scene, but it throws and never commits.
    rerender(tree(FULL_INDEX, true));

    let request;
    act(() => {
      request = actions.startProposal();
    });
    expect(request.snapshotAnchors).toBeNull();
    expect(request.capturedText).toBe("EXT. PARKING LOT - NIGHT\n\nA truck idles in the lot while someone watches the diner.");
    consoleError.mockRestore();
  });
});

describe("identities", () => {
  it("keeps draftActions for the life of the hook", () => {
    const { result, rerender } = renderDraft();
    const { actions } = current(result);

    place(result, "start", page1, 0);
    run(result, (a) => a.setTime("startTime", "00:00:05"));
    rerender({ index: textIndexFrom(SCRIPT_PAGES, { total: 3, complete: true }) });
    run(result, (a) => a.loadScene(savedV2Scene));
    run(result, (a) => a.reset());

    expect(current(result).actions).toBe(actions);
  });

  it("keeps anchors, previewScene and proposal identities while their inputs don't change", () => {
    const { result, rerender } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    const { anchors } = current(result).draft;
    const { start, end } = anchors;

    run(result, (a) => a.setTime("startTime", "00:00:05"));
    run(result, (a) => a.toggleTag("character-focus:protagonist"));
    run(result, (a) => a.editText("## INT. DINER - LATER"));
    const request = run(result, (a) => a.startProposal());
    const { proposal, previewScene } = current(result).draft;
    rerender({ index: FULL_INDEX });
    expect(current(result).draft.proposal).toBe(proposal);
    expect(current(result).draft.previewScene).toBe(previewScene);
    // The request token and requested selection stay private.
    expect(Object.keys(proposal).sort()).toEqual(["capturedPlainText", "error", "markdown", "status"]);

    run(result, (a) => a.proposalReady(request.token, "## AI"));
    run(result, (a) => a.discardProposal());
    // Explicit anchors don't depend on the text index.
    rerender({ index: textIndexFrom(SCRIPT_PAGES, { total: 3, complete: true }) });

    expect(current(result).draft.anchors).toBe(anchors);
    expect(current(result).draft.anchors.start).toBe(start);
    expect(current(result).draft.anchors.end).toBe(end);
  });

  it("keeps suggested anchors while their inputs don't change", () => {
    const { result, rerender } = renderDraft();
    run(result, (a) => a.loadScene(legacyScene));
    const { anchors } = current(result).draft;
    expect(current(result).draft.anchorsSuggested).toBe(true);

    run(result, (a) => a.setTime("startTime", "00:02:01"));
    run(result, (a) => a.toggleTag("character-focus:protagonist"));
    rerender({ index: FULL_INDEX });

    expect(current(result).draft.anchors).toBe(anchors);
  });
});

describe("capture work", () => {
  it("doesn't capture again for time, tag, text or proposal changes, or a re-render with the same index", () => {
    const { result, rerender } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    const calls = captureAnchoredRange.mock.calls.length;

    run(result, (a) => a.setTime("startTime", "1:00"));
    run(result, (a) => a.normalizeTime("startTime"));
    run(result, (a) => a.toggleTag("character-focus:protagonist"));
    run(result, (a) => a.editText("## INT. DINER - LATER"));
    const request = run(result, (a) => a.startProposal());
    run(result, (a) => a.proposalReady(request.token, "## AI"));
    run(result, (a) => a.discardProposal());
    rerender({ index: FULL_INDEX });

    expect(captureAnchoredRange.mock.calls.length).toBe(calls);
  });

  it("captures again, correctly, after an anchor change or a new index", () => {
    const { result, rerender } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    run(result, (a) => a.setTime("startTime", "00:01:00"));
    run(result, (a) => a.setTime("endTime", "00:02:00"));

    let calls = captureAnchoredRange.mock.calls.length;
    place(result, "end", page1, 4);
    expect(captureAnchoredRange.mock.calls.length).toBeGreaterThan(calls);
    expect(current(result).draft.text).toBe([`## ${DINER}`, RAIN, BELL].join("\n\n"));
    expect(run(result, (a) => a.buildSave(0)).payload).toMatchObject({
      page_start: 1,
      page_end: 1,
      start_offset: 0,
      end_offset: 242,
      context_suffix: `MAYA\nKitchen closed an hour ago.\nCoffee is all I can do.`,
      raw_selected_text: [DINER, RAIN, BELL].join("\n\n"),
    });

    calls = captureAnchoredRange.mock.calls.length;
    rerender({ index: textIndexFrom([page1], { total: 3 }) });
    expect(captureAnchoredRange.mock.calls.length).toBeGreaterThan(calls);
    expect(current(result).draft.text).toBe([`## ${DINER}`, RAIN, BELL].join("\n\n"));
    expect(run(result, (a) => a.buildSave(0)).payload).toMatchObject({ start_offset: null, end_offset: null });
  });
});

describe("AI proposal tokens", () => {
  it("uses one token per started request under StrictMode and ignores older tokens", () => {
    const { result } = renderDraft(FULL_INDEX, { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });

    expect(run(result, (a) => a.startProposal())).toBeNull();
    expect(current(result).draft.proposal).toBeNull();

    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
    const first = run(result, (a) => a.startProposal());
    const second = run(result, (a) => a.startProposal());
    expect([first.token, second.token]).toEqual([1, 2]);

    run(result, (a) => a.proposalReady(first.token, "## OLD"));
    expect(current(result).draft.proposal).toEqual({ status: "loading", markdown: "", error: "", capturedPlainText: P1_PLAIN });

    run(result, (a) => a.proposalReady(second.token, "## NEW"));
    expect(current(result).draft.proposal).toEqual({
      status: "ready",
      markdown: "## NEW",
      error: "",
      capturedPlainText: P1_PLAIN,
    });

    run(result, (a) => a.proposalFailed(first.token, "stale failure"));
    expect(current(result).draft.proposal.status).toBe("ready");

    run(result, (a) => a.discardProposal());
    run(result, (a) => a.proposalReady(second.token, "## AFTER DISCARD"));
    expect(current(result).draft.proposal).toBeNull();

    const third = run(result, (a) => a.startProposal());
    expect(third.token).toBe(3);
    run(result, (a) => a.loadScene(savedV2Scene));
    run(result, (a) => a.proposalFailed(third.token, "after load"));
    expect(current(result).draft.proposal).toBeNull();
  });

  it("returns request data from the committed view, falling back to the saved scene's pages", () => {
    const { result } = renderDraft(textIndexFrom([], { total: 3 }));
    run(result, (a) => a.loadScene(savedV2Scene));

    const request = run(result, (a) => a.startProposal());

    expect(request).toEqual({
      token: 1,
      capturedText: "EXT. PARKING LOT - NIGHT\n\nA truck idles in the lot while someone watches the diner.",
      draftMarkdown: savedV2Scene.formatted_selected_text,
      pageStart: 3,
      pageEnd: 3,
      snapshotAnchors: null,
    });
  });
});

describe("[H2] AI proposal provenance", () => {
  const AI_TEXT = "## AI HEADING\n\nWords from the formatter.";
  const PLACE_ANCHORS = "Place start and end anchors in the script to capture the scene text.";

  function anchorP1(result, endLine = 7) {
    place(result, "start", page1, 0);
    place(result, "end", page1, endLine);
  }

  function ready(result, request, markdown = AI_TEXT) {
    run(result, (a) => a.proposalReady(request.token, markdown));
  }

  it("accepts a proposal as fresh text when the selection is unchanged", () => {
    const { result } = renderDraft();
    anchorP1(result);
    ready(result, run(result, (a) => a.startProposal()));
    expect(current(result).draft.proposal).toEqual({
      status: "ready",
      markdown: AI_TEXT,
      error: "",
      capturedPlainText: P1_PLAIN,
    });

    run(result, (a) => a.acceptProposal());

    expect(current(result).draft).toMatchObject({
      text: AI_TEXT,
      textOrigin: "ai",
      textStale: false,
      capturedPlainText: P1_PLAIN,
      recaptureOption: "revert",
      editorKey: "1:1:0-1:7",
      proposal: null,
    });
  });

  it.each([
    {
      when: "while the request is pending",
      moveAndReady: (result, request) => {
        place(result, "end", page1, 4);
        ready(result, request);
      },
    },
    {
      when: "after the proposal is ready",
      moveAndReady: (result, request) => {
        ready(result, request);
        place(result, "end", page1, 4);
      },
    },
  ])("keeps the requested selection and word check when the anchors move $when", ({ moveAndReady }) => {
    const { result } = renderDraft();
    anchorP1(result);
    moveAndReady(result, run(result, (a) => a.startProposal()));

    // The draft's word check follows the moved capture; the proposal's stays with the text that was sent.
    expect(current(result).draft.capturedPlainText).toBe(P1_SHORT_PLAIN);
    expect(current(result).draft.proposal.capturedPlainText).toBe(P1_PLAIN);

    run(result, (a) => a.acceptProposal());

    expect(current(result).draft).toMatchObject({
      text: AI_TEXT,
      textOrigin: "ai",
      textStale: true,
      capturedPlainText: "",
      recaptureOption: "recapture",
      recaptureReplacesEdits: true,
      editorKey: "1:1:0-1:7",
    });

    place(result, "end", page1, 7);
    expect(current(result).draft).toMatchObject({ textStale: false, capturedPlainText: P1_PLAIN, recaptureOption: "revert" });
  });

  it("keeps the requested selection when the anchors are cleared, without changing what saving needs", () => {
    const { result } = renderDraft();
    anchorP1(result);
    run(result, (a) => a.setTime("startTime", "00:01:00"));
    run(result, (a) => a.setTime("endTime", "00:02:00"));
    ready(result, run(result, (a) => a.startProposal()));
    run(result, (a) => a.clearAnchors());

    run(result, (a) => a.acceptProposal());

    // Without a capture the text can't be stale, and a new draft still has no script location.
    expect(current(result).draft).toMatchObject({
      text: AI_TEXT,
      textOrigin: "ai",
      textStale: false,
      recaptureOption: "none",
      editorKey: "1:1:0-1:7",
    });
    expect(run(result, (a) => a.buildSave(0))).toEqual({ error: PLACE_ANCHORS });

    anchorP1(result, 4);
    expect(current(result).draft.textStale).toBe(true);
    place(result, "end", page1, 7);
    expect(current(result).draft).toMatchObject({ textStale: false, capturedPlainText: P1_PLAIN });
    expect(run(result, (a) => a.buildSave(0)).payload).toMatchObject({
      formatted_selected_text: AI_TEXT,
      raw_selected_text: P1_PLAIN,
      page_start: 1,
      page_end: 1,
    });
  });

  it.each([
    { kind: "legacy", scene: legacyScene, textStale: true, recaptureOption: "recapture" },
    { kind: "anchored", scene: savedV2Scene, textStale: false, recaptureOption: "revert" },
  ])(
    "keys a proposal requested before any capture to the $kind saved text's selection",
    ({ scene, textStale, recaptureOption }) => {
      const { result, rerender } = renderDraft(textIndexFrom([], { total: 3 }));
      run(result, (a) => a.loadScene(scene));
      ready(result, run(result, (a) => a.startProposal()));
      rerender({ index: FULL_INDEX });
      // A capture that appears later doesn't become the proposal's word check.
      expect(current(result).draft.proposal.capturedPlainText).toBe("");

      run(result, (a) => a.acceptProposal());

      expect(current(result).draft).toMatchObject({
        text: AI_TEXT,
        textOrigin: "ai",
        textStale,
        legacyText: false,
        recaptureOption,
      });
      expect(run(result, (a) => a.buildSave(0)).payload).toMatchObject({
        formatted_selected_text: AI_TEXT,
        page_start: scene.page_start,
      });
    }
  );

  it("takes the selection from the latest request, not a superseded one", () => {
    const { result } = renderDraft();
    anchorP1(result);
    const first = run(result, (a) => a.startProposal());
    place(result, "end", page1, 4);
    const second = run(result, (a) => a.startProposal());
    ready(result, first, "## OLD");
    ready(result, second);
    expect(current(result).draft.proposal).toEqual({
      status: "ready",
      markdown: AI_TEXT,
      error: "",
      capturedPlainText: P1_SHORT_PLAIN,
    });

    // Back on the superseded request's selection, the latest proposal's text is stale.
    place(result, "end", page1, 7);
    run(result, (a) => a.acceptProposal());

    expect(current(result).draft).toMatchObject({ text: AI_TEXT, textStale: true, editorKey: "1:1:0-1:4" });
  });

  it("leaves nothing of a discarded request to accept", () => {
    const { result } = renderDraft();
    anchorP1(result);
    run(result, (a) => a.editText("## EDITED\n\nTyped by hand."));
    const discarded = run(result, (a) => a.startProposal());
    run(result, (a) => a.discardProposal());
    place(result, "end", page1, 4);
    ready(result, discarded);
    run(result, (a) => a.acceptProposal());

    expect(current(result).draft).toMatchObject({
      textOrigin: "edited",
      textStale: true,
      editorKey: "0:1:0-1:7",
      proposal: null,
    });

    // A new request formats the current capture, so its accepted text is fresh.
    ready(result, run(result, (a) => a.startProposal()));
    expect(current(result).draft.proposal.capturedPlainText).toBe(P1_SHORT_PLAIN);
    run(result, (a) => a.acceptProposal());
    expect(current(result).draft).toMatchObject({ text: AI_TEXT, textOrigin: "ai", textStale: false, editorKey: "1:1:0-1:4" });
  });
});

describe("re-capture options", () => {
  const withAnchors = (result) => {
    place(result, "start", page1, 0);
    place(result, "end", page1, 7);
  };
  const moveEnd = (result) => place(result, "end", page1, 4);
  const edit = (result) => run(result, (a) => a.editText("## EDITED HEADING\n\nWords typed by hand."));
  const acceptAi = (result) => acceptAiText(result, "## AI HEADING\n\nWords from the formatter.");
  const loadSaved = (result) => run(result, (a) => a.loadScene(savedV2Scene));
  const EMPTY_INDEX = textIndexFrom([], { total: 3 });

  const cases = [
    { capture: "none", origin: "capture", index: EMPTY_INDEX, setup: () => {}, option: "none", replaces: false },
    { capture: "none", origin: "saved", index: EMPTY_INDEX, setup: loadSaved, option: "none", replaces: false },
    { capture: "none", origin: "edited", index: EMPTY_INDEX, setup: edit, option: "none", replaces: false },
    { capture: "none", origin: "ai", index: EMPTY_INDEX, setup: (r) => (edit(r), acceptAi(r)), option: "none", replaces: false },
    { capture: "fresh", origin: "capture", setup: withAnchors, option: "none", replaces: false },
    { capture: "fresh", origin: "saved", setup: loadSaved, option: "revert", replaces: false },
    {
      capture: "fresh",
      origin: "edited",
      setup: (r) => (withAnchors(r), edit(r)),
      option: "revert",
      replaces: true,
    },
    { capture: "fresh", origin: "ai", setup: (r) => (withAnchors(r), acceptAi(r)), option: "revert", replaces: true },
    // Captured text is never stale: its origin always follows the live capture.
    { capture: "stale", origin: "saved", setup: (r) => (loadSaved(r), place(r, "end", page3, 4)), option: "recapture", replaces: false },
    {
      capture: "stale",
      origin: "edited",
      setup: (r) => (withAnchors(r), edit(r), moveEnd(r)),
      option: "recapture",
      replaces: true,
    },
    {
      capture: "stale",
      origin: "ai",
      setup: (r) => (withAnchors(r), acceptAi(r), moveEnd(r)),
      option: "recapture",
      replaces: true,
    },
  ];

  it.each(cases)(
    "capture $capture, origin $origin → $option, replaces edits: $replaces",
    ({ capture, origin, index = FULL_INDEX, setup, option, replaces }) => {
      const { result } = renderDraft(index);
      setup(result);
      const { draft } = current(result);

      expect(draft.textOrigin).toBe(origin);
      expect(draft.textStale).toBe(capture === "stale");
      expect(draft.recaptureOption).toBe(option);
      expect(draft.recaptureReplacesEdits).toBe(replaces);
      expect(Boolean(draft.capturedPlainText)).toBe(capture === "fresh");

      run(result, (a) => a.recapture());
      const after = current(result).draft;
      if (capture === "none") {
        expect(after.editorKey).toBe(draft.editorKey);
        expect(after.text).toBe(draft.text);
        expect(after.textOrigin).toBe(origin);
      } else {
        expect(after.textOrigin).toBe("capture");
        expect(after.editorKey).not.toBe(draft.editorKey);
        expect(after.recaptureOption).toBe("none");
      }
    }
  );
});

describe("editorKey", () => {
  it("follows the capture while Captured, keeps the key on edits, and bumps the revision on replacement", () => {
    const { result } = renderDraft();
    const key = () => current(result).draft.editorKey;

    expect(key()).toBe("0:");
    place(result, "start", page1, 0);
    expect(key()).toBe("0:");
    place(result, "end", page1, 7);
    expect(key()).toBe("0:1:0-1:7");

    run(result, (a) => a.setTime("startTime", "00:00:05"));
    run(result, (a) => a.toggleTag("character-focus:protagonist"));
    const request = run(result, (a) => a.startProposal());
    run(result, (a) => a.proposalFailed(request.token, "failed"));
    run(result, (a) => a.discardProposal());
    expect(key()).toBe("0:1:0-1:7");

    run(result, (a) => a.editText("## INT. DINER - LATER"));
    expect(key()).toBe("0:1:0-1:7");
    place(result, "end", page1, 4);
    expect(key()).toBe("0:1:0-1:7");

    run(result, (a) => a.recapture());
    expect(key()).toBe("1:1:0-1:4");

    const discarded = run(result, (a) => a.startProposal());
    run(result, (a) => a.proposalReady(discarded.token, "## AI"));
    run(result, (a) => a.discardProposal());
    expect(key()).toBe("1:1:0-1:4");

    acceptAiText(result, "## AI HEADING\n\nWords from the formatter.");
    expect(key()).toBe("2:1:0-1:4");

    run(result, (a) => a.loadScene(savedV2Scene));
    expect(key()).toBe("3:3:0-3:3");

    run(result, (a) => a.reset());
    expect(key()).toBe("4:");
  });
});

describe("anchor undo", () => {
  it("keeps at most 50 anchor pairs of history", () => {
    const { result } = renderDraft();
    for (let placement = 1; placement <= 60; placement += 1) {
      place(result, "start", page1, placement % 2);
    }

    for (let undo = 1; undo <= 49; undo += 1) run(result, (a) => a.undoAnchors());
    expect(current(result).draft.canUndoAnchors).toBe(true);
    run(result, (a) => a.undoAnchors());
    expect(current(result).draft.canUndoAnchors).toBe(false);
    // The oldest ten entries (back to no anchors) were dropped.
    expect(current(result).draft.anchors.start).toMatchObject({ page: 1, line: 0 });
  });

  it("doesn't add history when an anchor is placed again on the same line", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "start", page1, 0);

    run(result, (a) => a.undoAnchors());

    expect(current(result).draft.anchors.start).toBeNull();
    expect(current(result).draft.canUndoAnchors).toBe(false);
  });

  it("[A6] swaps start and end when the end would come first", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 7);
    place(result, "end", page1, 0);
    expect(current(result).draft.anchors).toMatchObject({ start: { line: 0 }, end: { line: 7 } });

    place(result, "start", page2, 1);
    expect(current(result).draft.anchors).toMatchObject({ start: { page: 1, line: 7 }, end: { page: 2, line: 1 } });
  });

  it("[A8] ignores lines on unindexed pages and missing lines", () => {
    const { result } = renderDraft(textIndexFrom([page1], { total: 3 }));
    place(result, "start", page3, 0);
    run(result, (a) => a.setAnchorAtLine("end", 1, null));

    expect(current(result).draft.anchors).toEqual({ start: null, end: null });
    expect(current(result).draft.canUndoAnchors).toBe(false);
  });

  it("[A4] clearing suggested anchors dismisses them without adding history", () => {
    const { result } = renderDraft();
    run(result, (a) => a.loadScene(legacyScene));
    expect(current(result).draft.anchorsSuggested).toBe(true);

    run(result, (a) => a.clearAnchors());

    expect(current(result).draft.anchorsSuggested).toBe(false);
    expect(current(result).draft.anchors).toEqual({ start: null, end: null });
    expect(current(result).draft.canUndoAnchors).toBe(false);
  });
});

describe("persistence completions", () => {
  it("acknowledges a save without replacing newer text or remounting its editor", () => {
    const { result } = renderDraft();
    run(result, a => a.loadScene(savedV2Scene));
    const save = run(result, a => a.buildSave(0));
    run(result, a => a.editText("## NEWER TEXT\n\nStill editing."));
    const editorKey = current(result).draft.editorKey;
    const saved = { ...savedV2Scene, ...save.payload };
    act(() => save.applySaved(saved));
    expect(current(result).draft.savedScene).toBe(saved);
    expect(current(result).draft.text).toBe("## NEWER TEXT\n\nStill editing.");
    expect(current(result).draft.editorKey).toBe(editorKey);
    expect(current(result).draft.dirty).toBe(true);
  });

  it("preserves edits queued before a save response in the same React batch", () => {
    const { result } = renderDraft();
    run(result, a => a.loadScene(savedV2Scene));
    const save = run(result, a => a.buildSave(0));
    act(() => {
      current(result).actions.setTime("endTime", "00:11:30");
      save.applySaved({ ...savedV2Scene, ...save.payload });
    });
    expect(current(result).draft.endTime).toBe("00:11:30");
    expect(current(result).draft.dirty).toBe(true);
  });

  it("ignores a save response after a reset queued in the same React batch", () => {
    const { result } = renderDraft();
    run(result, a => a.loadScene(savedV2Scene));
    const save = run(result, a => a.buildSave(0));
    act(() => {
      current(result).actions.reset();
      save.applySaved({ ...savedV2Scene, ...save.payload });
    });
    expect(current(result).draft.savedScene).toBeNull();
    expect(current(result).draft.text).toBe("");
  });

  it("detaches newer edits from a deleted row and invalidates its pending save", () => {
    const { result } = renderDraft();
    run(result, a => a.loadScene(savedV2Scene));
    const save = run(result, a => a.buildSave(0));
    const deleted = run(result, a => a.prepareDelete(savedV2Scene.id));
    act(() => {
      current(result).actions.editText("## UNSAVED\n\nKeep this text.");
      deleted();
      save.applySaved({ ...savedV2Scene, ...save.payload });
    });
    expect(current(result).draft.savedScene).toBeNull();
    expect(current(result).draft.text).toBe("## UNSAVED\n\nKeep this text.");
    expect(current(result).draft.dirty).toBe(true);
  });
});

describe("buildSave", () => {
  const PLACE_ANCHORS = "Place start and end anchors in the script to capture the scene text.";

  it("[B1] checks film timing, then text, then script location", () => {
    const { result } = renderDraft(textIndexFrom([], { total: 3 }));
    const save = (runtime = 0) => run(result, (a) => a.buildSave(runtime));

    expect(save()).toEqual({ error: "Enter a start and an end time for this scene." });
    run(result, (a) => a.setTime("startTime", "abc"));
    expect(save()).toEqual({ error: "Use HH:MM:SS (or MM:SS) for the start and end times." });
    run(result, (a) => a.setTime("startTime", "00:02:00"));
    run(result, (a) => a.setTime("endTime", "00:01:00"));
    expect(save()).toEqual({ error: "The end time must be at or after the start time." });
    run(result, (a) => a.setTime("startTime", "00:00:10"));
    run(result, (a) => a.setTime("endTime", "00:01:00"));
    expect(save(30)).toEqual({ error: "Times can't be later than the film's runtime (00:00:30)." });
    // A runtime of 0 means unknown.
    expect(save(0)).toEqual({ error: PLACE_ANCHORS });

    run(result, (a) => a.editText("## HEADING\n\nWords with nowhere to go."));
    expect(save(0)).toEqual({ error: PLACE_ANCHORS });
  });

  it("[B2, B3, B7] maps a capture with explicit anchors", () => {
    const { result } = renderDraft(textIndexFrom([page1, page2], { total: 3 }));
    place(result, "start", page1, 1);
    place(result, "end", page1, 7);
    run(result, (a) => a.setTime("startTime", "00:01:00"));
    run(result, (a) => a.setTime("endTime", "00:02:30"));
    run(result, (a) => a.toggleTag("mood:tense"));
    run(result, (a) => a.toggleTag("character-focus:protagonist"));

    const markdown = [RAIN, BELL, "### MAYA", `> ${MAYA_SPEECH}`].join("\n\n");
    expect(run(result, (a) => a.buildSave(7200))).toEqual({
      applySaved: expect.any(Function),
      confirmStaleText: false,
      payload: {
        start_time_seconds: 60,
        end_time_seconds: 150,
        selected_text: markdown,
        raw_selected_text: [RAIN, BELL, "MAYA", MAYA_SPEECH].join("\n\n"),
        formatted_selected_text: markdown,
        page_start: 1,
        page_end: 1,
        start_offset: null,
        end_offset: null,
        context_prefix: DINER,
        // An empty capture context is saved as null.
        context_suffix: null,
        anchor_geometry: [
          {
            kind: "start",
            version: 2,
            unit: "pt",
            page: 1,
            line: 1,
            top: 110.2,
            bottom: 122.9,
            text: "Rain streaks the windows of an empty roadside diner at",
          },
          { kind: "end", version: 2, unit: "pt", page: 1, line: 7, top: 206.2, bottom: 218.9, text: "Coffee is all I can do." },
        ],
        tags: ["mood:tense", "character-focus:protagonist"],
      },
    });
  });

  it("[B2, B3] keeps a saved scene's stored fields, turning missing ones into null and non-array geometry into []", () => {
    const scene = {
      id: "scene-stored",
      start_time_seconds: 60,
      end_time_seconds: 90,
      tags: ["mood:tense"],
      page_start: 4,
      selected_text: "",
      raw_selected_text: "",
      formatted_selected_text: "## HEADING\n\nWords here.",
      context_prefix: "",
      anchor_geometry: null,
    };
    const { result } = renderDraft(textIndexFrom([], { total: 3 }));
    run(result, (a) => a.loadScene(scene));

    expect(run(result, (a) => a.buildSave(0))).toEqual({
      applySaved: expect.any(Function),
      confirmStaleText: false,
      payload: {
        start_time_seconds: 60,
        end_time_seconds: 90,
        selected_text: "## HEADING\n\nWords here.",
        // Stored raw text is empty, so it is derived from the scene text.
        raw_selected_text: "HEADING\n\nWords here.",
        formatted_selected_text: "## HEADING\n\nWords here.",
        page_start: 4,
        page_end: null,
        start_offset: null,
        end_offset: null,
        // A stored empty context stays empty.
        context_prefix: "",
        context_suffix: null,
        anchor_geometry: [],
        tags: ["mood:tense"],
      },
    });
  });

  it("[B4] copies a legacy scene's non-version-2 geometry as stored", () => {
    const pixelRects = [{ page: 1, x: 72, y: 90, width: 400, height: 14 }];
    const scene = sceneRow({ ...legacyScene, id: "scene-pixels", anchor_geometry: pixelRects });
    const { result } = renderDraft();
    run(result, (a) => a.loadScene(scene));
    expect(current(result).draft.anchorsSuggested).toBe(true);

    const { payload } = run(result, (a) => a.buildSave(0));

    expect(payload.anchor_geometry).toBe(scene.anchor_geometry);
    expect(payload.raw_selected_text).toBe(legacyScene.raw_selected_text);
    expect(payload.page_start).toBe(1);
  });
});

describe("[B5] explicit anchors need a capture to save", () => {
  const PLACE_START = "Place a start anchor in the script before saving.";
  const PLACE_END = "Place an end anchor in the script before saving.";
  const WAIT_FOR_INDEX = "Wait for the pages between the anchors to finish indexing, then save again.";
  const UNREADABLE = "The script text between the anchors can't be read. Move the anchors to lines with text, then save again.";
  const save = (result) => run(result, (a) => a.buildSave(0));

  function setTiming(result) {
    run(result, (a) => a.setTime("startTime", "00:01:00"));
    run(result, (a) => a.setTime("endTime", "00:02:00"));
  }

  it("asks for the missing anchor after checking timing and before checking for empty text", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    expect(save(result)).toEqual({ error: "Enter a start and an end time for this scene." });

    setTiming(result);
    expect(current(result).draft.text).toBe("");
    expect(save(result)).toEqual({ error: PLACE_END });

    place(result, "end", page1, 7);
    run(result, (a) => a.removeAnchor("start"));
    expect(save(result)).toEqual({ error: PLACE_START });
  });

  it("refuses a saved scene with a removed anchor, keeps the draft, and saves the capture once the anchor is back", () => {
    const EDITED = "## EDITED\n\nKeep this text.";
    const { result } = renderDraft();
    run(result, (a) => a.loadScene(savedV2Scene));
    run(result, (a) => a.editText(EDITED));
    run(result, (a) => a.removeAnchor("end"));

    expect(save(result)).toEqual({ error: PLACE_END });
    expect(current(result).draft).toMatchObject({
      text: EDITED,
      textOrigin: "edited",
      anchors: { start: { page: 3, line: 0 }, end: null },
      startTime: "00:10:00",
      dirty: true,
    });

    place(result, "end", page3, 3);
    expect(save(result).payload).toMatchObject({
      formatted_selected_text: EDITED,
      page_start: 3,
      page_end: 3,
      start_offset: 419,
      context_prefix: null,
      anchor_geometry: savedV2Scene.anchor_geometry,
    });
  });

  it("asks to wait while the range's pages index, then saves before the whole script is indexed", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1], { total: 3 }));
    run(result, (a) => a.loadScene(savedV2Scene));

    expect(save(result)).toEqual({ error: WAIT_FOR_INDEX });
    expect(current(result).draft).toMatchObject({ textOrigin: "saved", text: savedV2Scene.formatted_selected_text, dirty: false });

    rerender({ index: textIndexFrom([page1, page3], { total: 3 }) });
    expect(save(result).payload).toMatchObject({
      formatted_selected_text: savedV2Scene.formatted_selected_text,
      page_start: 3,
      page_end: 3,
      start_offset: null,
      end_offset: null,
      anchor_geometry: savedV2Scene.anchor_geometry,
    });
  });

  it("stops asking to wait once indexing has finished without a page in the range", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1, page3], { total: 3 }));
    place(result, "start", page1, 0);
    place(result, "end", page3, 3);
    setTiming(result);
    expect(save(result)).toEqual({ error: WAIT_FOR_INDEX });

    // Page 2 never produced text, as with a scanned page.
    rerender({ index: textIndexFrom([page1, page3], { total: 3, complete: true }) });
    expect(save(result)).toEqual({ error: UNREADABLE });
  });

  it("doesn't ask to wait when an indexed page has no line for an anchor", () => {
    const { result } = renderDraft(textIndexFrom([page1, positionedPage(3, [])], { total: 3 }));
    run(result, (a) => a.loadScene(savedV2Scene));

    expect(save(result)).toEqual({ error: UNREADABLE });
  });

  it.each([
    { when: "before its pages are indexed", index: textIndexFrom([], { total: 3 }), suggested: false },
    { when: "with suggested anchors and their capture", index: FULL_INDEX, suggested: true },
  ])("still saves a legacy scene's stored location $when", ({ index, suggested }) => {
    const { result } = renderDraft(index);
    run(result, (a) => a.loadScene(legacyScene));
    expect(current(result).draft.anchorsSuggested).toBe(suggested);

    expect(save(result).payload).toMatchObject({
      raw_selected_text: legacyScene.raw_selected_text,
      page_start: 1,
      page_end: 2,
      anchor_geometry: [],
    });
  });
});

describe("[B6] stale text under explicit anchors needs confirmation to save", () => {
  const EDITED = "## EDITED HEADING\n\nWords typed by hand.";
  const AI_TEXT = "## AI HEADING\n\nWords from the formatter.";
  const PLACE_ANCHORS = "Place start and end anchors in the script to capture the scene text.";
  /** Captured plain text for p3 lines 1–5. */
  const P3_PLAIN = [
    "EXT. PARKING LOT - NIGHT",
    "Headlights sweep across the gravel as a truck pulls in slow. Its engine ticks in the cold while the wipers keep going.",
    "Inside the cab, a figure watches the diner window and waits. Nobody gets out, and nobody in the diner seems to notice.",
  ].join("\n\n");
  /** The raw text and script location captured from p1 lines 1–5. */
  const P1_SHORT_CAPTURE = {
    raw_selected_text: P1_SHORT_PLAIN,
    page_start: 1,
    page_end: 1,
    start_offset: 0,
    end_offset: 242,
    context_prefix: null,
    context_suffix: `MAYA\nKitchen closed an hour ago.\nCoffee is all I can do.`,
    anchor_geometry: v2Geometry(page1, 0, page1, 4),
  };
  const save = (result) => run(result, (a) => a.buildSave(0));

  function setTiming(result) {
    run(result, (a) => a.setTime("startTime", "00:01:00"));
    run(result, (a) => a.setTime("endTime", "00:02:00"));
  }

  function anchorP1(result, endLine = 7) {
    place(result, "start", page1, 0);
    place(result, "end", page1, endLine);
  }

  /** What building a save, and so confirming or canceling it, must leave alone. */
  function draftState(result) {
    const { draft } = current(result);
    const { text, textOrigin, textStale, legacyText, editorKey, dirty, anchors, savedScene, recaptureOption } = draft;
    return { text, textOrigin, textStale, legacyText, editorKey, dirty, anchors, savedScene, recaptureOption };
  }

  it.each([
    {
      origin: "saved",
      setup: (result) => {
        run(result, (a) => a.loadScene(savedV2Scene));
        place(result, "end", page3, 4);
      },
      payload: {
        start_time_seconds: 600,
        end_time_seconds: 660,
        selected_text: SAVED_V2_TEXT,
        raw_selected_text: P3_PLAIN,
        formatted_selected_text: SAVED_V2_TEXT,
        page_start: 3,
        page_end: 3,
        start_offset: 419,
        end_offset: 681,
        context_prefix: null,
        context_suffix: null,
        anchor_geometry: v2Geometry(page3, 0, page3, 4),
        tags: savedV2Scene.tags,
      },
    },
    {
      origin: "edited",
      setup: (result) => {
        anchorP1(result);
        setTiming(result);
        run(result, (a) => a.editText(EDITED));
        place(result, "end", page1, 4);
      },
      payload: {
        start_time_seconds: 60,
        end_time_seconds: 120,
        selected_text: EDITED,
        formatted_selected_text: EDITED,
        ...P1_SHORT_CAPTURE,
        tags: [],
      },
    },
    {
      origin: "ai",
      setup: (result) => {
        anchorP1(result);
        setTiming(result);
        acceptAiText(result, AI_TEXT);
        place(result, "end", page1, 4);
      },
      payload: {
        start_time_seconds: 60,
        end_time_seconds: 120,
        selected_text: AI_TEXT,
        formatted_selected_text: AI_TEXT,
        ...P1_SHORT_CAPTURE,
        tags: [],
      },
    },
  ])("asks to confirm stale $origin text, mapped with the current capture, without changing the draft", ({ origin, setup, payload }) => {
    const { result } = renderDraft();
    setup(result);
    const before = draftState(result);
    expect(before).toMatchObject({ textOrigin: origin, textStale: true, recaptureOption: "recapture" });

    expect(save(result)).toEqual({ payload, applySaved: expect.any(Function), confirmStaleText: true });
    expect(draftState(result)).toEqual(before);
  });

  it("doesn't ask for fresh text of any origin, including stale text whose anchors return", () => {
    const { result } = renderDraft();
    anchorP1(result);
    setTiming(result);
    expect(save(result)).toMatchObject({ confirmStaleText: false, payload: { raw_selected_text: P1_PLAIN } });

    run(result, (a) => a.editText(EDITED));
    expect(save(result)).toMatchObject({ confirmStaleText: false, payload: { formatted_selected_text: EDITED } });
    place(result, "end", page1, 4);
    expect(save(result).confirmStaleText).toBe(true);
    place(result, "end", page1, 7);
    expect(save(result)).toMatchObject({
      confirmStaleText: false,
      payload: { formatted_selected_text: EDITED, raw_selected_text: P1_PLAIN },
    });

    acceptAiText(result, AI_TEXT);
    expect(save(result)).toMatchObject({ confirmStaleText: false, payload: { formatted_selected_text: AI_TEXT } });

    run(result, (a) => a.loadScene(savedV2Scene));
    expect(save(result)).toMatchObject({ confirmStaleText: false, payload: { formatted_selected_text: SAVED_V2_TEXT } });
  });

  it("doesn't ask without explicit anchors, and asks once suggested anchors become explicit", () => {
    const { result } = renderDraft();
    run(result, (a) => a.loadScene(legacyScene));
    expect(current(result).draft).toMatchObject({ anchorsSuggested: true, textStale: true, legacyText: true });
    expect(save(result)).toMatchObject({
      confirmStaleText: false,
      payload: { raw_selected_text: LEGACY_RAW, page_start: 1, page_end: 2, anchor_geometry: [] },
    });

    place(result, "end", page2, 4);
    expect(current(result).draft).toMatchObject({ anchorsSuggested: false, textStale: true, textOrigin: "saved" });
    const explicit = save(result);
    expect(explicit).toMatchObject({
      confirmStaleText: true,
      payload: { selected_text: LEGACY_RAW, page_start: 1, page_end: 2, anchor_geometry: v2Geometry(page1, 0, page2, 4) },
    });
    expect(explicit.payload.raw_selected_text).not.toBe(LEGACY_RAW);

    // Clearing every anchor on a saved scene still keeps its stored location, without asking.
    run(result, (a) => a.loadScene(savedV2Scene));
    place(result, "end", page3, 4);
    run(result, (a) => a.clearAnchors());
    expect(save(result)).toMatchObject({
      confirmStaleText: false,
      payload: { raw_selected_text: savedV2Scene.raw_selected_text, anchor_geometry: savedV2Scene.anchor_geometry },
    });
  });

  it("returns validation errors before asking: timing, then a missing capture, then blank text", () => {
    const { result } = renderDraft();
    anchorP1(result);
    run(result, (a) => a.editText(EDITED));
    place(result, "end", page1, 4);
    expect(current(result).draft.textStale).toBe(true);
    expect(save(result)).toEqual({ error: "Enter a start and an end time for this scene." });

    setTiming(result);
    run(result, (a) => a.removeAnchor("end"));
    expect(save(result)).toEqual({ error: "Place an end anchor in the script before saving." });

    run(result, (a) => a.undoAnchors());
    run(result, (a) => a.editText("   "));
    expect(current(result).draft.textStale).toBe(true);
    expect(save(result)).toEqual({ error: PLACE_ANCHORS });

    run(result, (a) => a.editText(EDITED));
    expect(save(result).confirmStaleText).toBe(true);
  });

  it("decides again for each save, so a confirmed payload never covers later edits", () => {
    const NEWER = "## NEWER HEADING\n\nTyped after the prompt.";
    const { result } = renderDraft();
    anchorP1(result);
    setTiming(result);
    run(result, (a) => a.editText(EDITED));
    place(result, "end", page1, 4);

    const confirmed = save(result);
    expect(confirmed.confirmStaleText).toBe(true);

    run(result, (a) => a.editText(NEWER));
    expect(save(result)).toMatchObject({ confirmStaleText: true, payload: { formatted_selected_text: NEWER } });
    expect(confirmed.payload.formatted_selected_text).toBe(EDITED);

    run(result, (a) => a.recapture());
    expect(save(result)).toMatchObject({
      confirmStaleText: false,
      payload: { formatted_selected_text: [`## ${DINER}`, RAIN, BELL].join("\n\n"), raw_selected_text: P1_SHORT_PLAIN },
    });
  });

  it("asks again after a response for a draft that changed during the save, but not once the response reloads it", () => {
    const { result } = renderDraft();
    anchorP1(result);
    setTiming(result);
    acceptAiText(result, AI_TEXT);
    place(result, "end", page1, 4);

    const confirmed = save(result);
    expect(confirmed.confirmStaleText).toBe(true);
    const { editorKey } = current(result).draft;
    run(result, (a) => a.setTime("endTime", "00:02:30"));
    const created = sceneRow({ ...confirmed.payload, id: "scene-created" });
    act(() => confirmed.applySaved(created));

    expect(current(result).draft).toMatchObject({
      savedScene: created,
      text: AI_TEXT,
      textOrigin: "ai",
      textStale: true,
      editorKey,
      endTime: "00:02:30",
      dirty: true,
    });
    const next = save(result);
    expect(next).toMatchObject({ confirmStaleText: true, payload: { end_time_seconds: 150, formatted_selected_text: AI_TEXT } });

    act(() => next.applySaved({ ...created, ...next.payload }));
    expect(current(result).draft).toMatchObject({ textOrigin: "saved", textStale: false, dirty: false });
    expect(save(result)).toMatchObject({ confirmStaleText: false, payload: { formatted_selected_text: AI_TEXT } });
  });

  it("asks for a draft opened during a confirmed save only by that draft's own text and anchors", () => {
    const { result } = renderDraft();
    run(result, (a) => a.loadScene(savedV2Scene));
    place(result, "end", page3, 4);
    const confirmed = save(result);
    expect(confirmed.confirmStaleText).toBe(true);

    run(result, (a) => a.loadScene(otherScene));
    expect(save(result).confirmStaleText).toBe(false);
    act(() => confirmed.applySaved({ ...savedV2Scene, ...confirmed.payload }));
    expect(current(result).draft.savedScene).toBe(otherScene);
    expect(save(result).confirmStaleText).toBe(false);

    place(result, "end", page2, 4);
    expect(save(result)).toMatchObject({ confirmStaleText: true, payload: { formatted_selected_text: OTHER_TEXT } });
  });
});

describe("suggested anchors and saved scene keys", () => {
  it("[A1] suggests nothing with fewer than 3 comparable words, or when the start would follow the end", () => {
    const tooShort = sceneRow({ id: "scene-short", page_start: 1, page_end: 2, raw_selected_text: "INT. DINER" });
    const reversed = sceneRow({
      id: "scene-reversed",
      page_start: 2,
      page_end: 1,
      raw_selected_text: "Then coffee. And the booth by the window. Coffee is all I can do.",
    });

    for (const scene of [tooShort, reversed]) {
      const { result, unmount } = renderDraft();
      run(result, (a) => a.loadScene(scene));
      expect(current(result).draft.anchorsSuggested).toBe(false);
      expect(current(result).draft.anchors).toEqual({ start: null, end: null });
      unmount();
    }
  });

  it("[A1] suggests anchors once a later index includes the saved pages", () => {
    const { result, rerender } = renderDraft(textIndexFrom([page1], { total: 3 }));
    run(result, (a) => a.loadScene(legacyScene));
    expect(current(result).draft.anchorsSuggested).toBe(false);

    rerender({ index: FULL_INDEX });

    const { draft } = current(result);
    expect(draft.anchorsSuggested).toBe(true);
    expect(draft.anchors.start).toMatchObject({ page: 1, line: 0, suggested: true });
    expect(draft.anchors.end).toMatchObject({ page: 2, line: 5, suggested: true });
    expect(draft).toMatchObject({ textStale: true, legacyText: true, recaptureOption: "recapture", dirty: false });
    expect(draft.canUndoAnchors).toBe(false);
  });

  it("[D7] keys saved text by page and line only", () => {
    const moved = savedV2Scene.anchor_geometry.map((entry) => ({ ...entry, top: entry.top + 1.5, text: "retyped" }));
    const scene = sceneRow({ ...savedV2Scene, id: "scene-shifted", anchor_geometry: moved });
    const { result } = renderDraft();
    run(result, (a) => a.loadScene(scene));

    expect(current(result).draft).toMatchObject({ textOrigin: "saved", textStale: false, legacyText: false, dirty: false });
    expect(current(result).draft.capturedPlainText).toContain("Headlights sweep across the gravel");
  });

  it("previews a scene from the draft, taking pages from the capture, else the saved scene", () => {
    const { result } = renderDraft(textIndexFrom([], { total: 3 }));
    run(result, (a) => a.loadScene(savedV2Scene));
    run(result, (a) => a.setTime("endTime", "11:xx"));

    expect(current(result).draft.previewScene).toEqual({
      start_time_seconds: 600,
      end_time_seconds: null,
      page_start: 3,
      page_end: 3,
      tags: savedV2Scene.tags,
      formatted_selected_text: savedV2Scene.formatted_selected_text,
    });

    run(result, (a) => a.reset());
    expect(current(result).draft.previewScene).toMatchObject({ page_start: null, page_end: null, formatted_selected_text: "" });
  });
});
