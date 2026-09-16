import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  marginShiftPage,
  OTHER_TEXT,
  otherScene,
  page1,
  page2,
  page3,
  positionedPage,
  SAVED_TEXT,
  savedScene,
  sceneRow,
  SCRIPT_PAGES,
  scriptLocation,
  textIndexFrom,
} from "../test/textIndexFixtures.js";
import { captureAnchoredRange, captureUnavailableReason } from "./captureRange.js";
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
const P1_SHORT_PLAIN = [DINER, RAIN, BELL].join("\n\n");

function renderDraft(index = FULL_INDEX) {
  return renderHook(({ currentIndex }) => useSceneDraft(currentIndex), { initialProps: { currentIndex: index } });
}

function view(result) {
  const [draft, actions] = result.current;
  return { draft, actions };
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

beforeEach(() => {
  captureAnchoredRange.mockClear();
});

describe("capture and canonical save contract", () => {
  it("captures a complete anchor pair and emits only canonical fields", () => {
    const { result } = renderDraft();
    place(result, "start", page1, 0);
    place(result, "end", page1, 4);
    setTiming(result);
    run(result, (actions) => actions.toggleTag("mood:tense"));

    const { payload, confirmStaleText } = save(result);
    expect(payload).toEqual({
      start_time_seconds: 60,
      end_time_seconds: 120,
      script_location: scriptLocation(page1, 0, page1, 4),
      scene_text: P1_SHORT_MARKDOWN,
      raw_text: P1_SHORT_PLAIN,
      tags: ["mood:tense"],
    });
    expect(confirmStaleText).toBe(false);
    expect(Object.keys(payload).sort()).toEqual([
      "end_time_seconds",
      "raw_text",
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

  it.each([
    ["page above the contract cap", { end: { page: 100001 } }],
    ["line above the contract cap", { end: { line: 100001 } }],
    ["non-string anchor text", { end: { text: null } }],
    ["non-finite geometry", { end: { top: Number.NaN } }],
    ["reversed anchors", { start: { page: 3, line: 4 }, end: { page: 3, line: 0 } }],
  ])("refuses capture for a location with %s", (_, changes) => {
    const valid = scriptLocation(page3, 0, page3, 4);
    const invalid = {
      start: { ...valid.start, ...changes.start },
      end: { ...valid.end, ...changes.end },
    };
    expect(captureAnchoredRange(FULL_INDEX, invalid)).toBeNull();
    expect(captureUnavailableReason(FULL_INDEX, invalid)).toBe("unreadable");
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
          raw_text: "Previous raw text.",
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
      payload: { scene_text: "## EDITED\n\nHand-written text.", raw_text: P1_SHORT_PLAIN },
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
    expect(view(result).draft.anchors).toMatchObject({ start: expect.objectContaining({ page: 2, line: 3 }), end: null });
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
