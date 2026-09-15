import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/lib/errors.js";
import { captureAnchoredRange } from "../model/captureRange.js";
import {
  annotator,
  answerConfirm,
  clickSceneBar,
  currentLocation,
  editorBlock,
  editorDialog,
  fail,
  fakeApi,
  flush,
  frameProps,
  hoverLine,
  loadedPdfDocument,
  menuItem,
  openLineMenu,
  pending,
  placeAnchorsWithKeys,
  pressKey,
  publishPages,
  queryAnnotator,
  renderSelectionSnapshots,
  renderViewer,
  resetHarness,
  sceneCard,
  settle,
  timeInput,
  typeTime,
} from "../test/pageHarness.js";
import {
  LEGACY_RAW,
  legacyScene,
  marginShiftPage,
  otherScene,
  page1,
  page2,
  page3,
  SAVED_V2_TEXT,
  savedV2Scene,
  SCRIPT_PAGES,
} from "../test/textIndexFixtures.js";
import ScriptViewerRoute from "./ScriptViewerPage.jsx";

/*
 * Characterization of the script viewer's scene draft workflow, written
 * against the page before the scene draft refactor. Only external edges are
 * doubled (API, session, PDF rendering, the text indexer, page windowing, page
 * frames and AI snapshots); the panel, editor, dialogs, anchors, capture and
 * screenplay code are real. Tests named "existing compatibility behavior" pin
 * behavior that may be a bug; a fix must change them deliberately.
 */

vi.mock("@/shared/api/annotations.js", async () => (await import("../test/pageHarness.js")).apiModules.annotations);
vi.mock("@/shared/api/movies.js", async () => (await import("../test/pageHarness.js")).apiModules.movies);
vi.mock("@/shared/api/screenplayFormat.js", async () => (await import("../test/pageHarness.js")).apiModules.screenplayFormat);
vi.mock("@/shared/api/scriptScenes.js", async () => (await import("../test/pageHarness.js")).apiModules.scriptScenes);
vi.mock("@/shared/api/scripts.js", async () => (await import("../test/pageHarness.js")).apiModules.scripts);
vi.mock("@/shared/api/uploads.js", async () => (await import("../test/pageHarness.js")).apiModules.uploads);
vi.mock("@/entities/session/model/useSession.js", async () => (await import("../test/pageHarness.js")).sessionModule);
vi.mock("react-pdf", async () => (await import("../test/pageHarness.js")).reactPdfModule);
vi.mock("../model/useScriptTextIndex.js", async () => (await import("../test/pageHarness.js")).textIndexModule);
vi.mock("../model/usePdfPageWindowing.js", async () => (await import("../test/pageHarness.js")).windowingModule);
vi.mock("./PdfPageFrame.jsx", async () => (await import("../test/pageHarness.js")).pdfPageFrameModule);
vi.mock("../lib/pageSnapshots.js", async () => (await import("../test/pageHarness.js")).pageSnapshotsModule);
// A passthrough spy: capture runs for real everywhere; only P18 counts calls.
vi.mock("../model/captureRange.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, captureAnchoredRange: vi.fn(actual.captureAnchoredRange) };
});

// ---------- Expected script text (from the fixture pages) ----------

const DINER = "INT. DINER - NIGHT";
const RAIN =
  "Rain streaks the windows of an empty roadside diner at midnight. MAYA, thirties, wipes the counter in slow circles.";
const BELL = "A bell over the door rings. SAM steps in from the storm, shaking water from a battered canvas coat and hat.";
const MAYA_SPEECH = "Kitchen closed an hour ago. Coffee is all I can do.";
const SAM_SPEECH = "Then coffee. And the booth by the window.";
const POURS = "Maya pours two cups and slides one across the counter.";
const PARKING_LOT = "EXT. PARKING LOT - NIGHT";
const HEADLIGHTS =
  "Headlights sweep across the gravel as a truck pulls in slow. Its engine ticks in the cold while the wipers keep going.";
const CAB = "Inside the cab, a figure watches the diner window and waits.";
const NOBODY = "Nobody gets out, and nobody in the diner seems to notice.";

/** Captured text for p1 line 1 through p2 line 4. */
const CAPTURE_P1_TO_P2 = {
  markdown: [`## ${DINER}`, RAIN, BELL, "### MAYA", `> ${MAYA_SPEECH}`, "### SAM", `> > (quietly)\n>\n> ${SAM_SPEECH}`].join(
    "\n\n"
  ),
  plainText: [DINER, RAIN, BELL, "MAYA", MAYA_SPEECH, "SAM", "(quietly)", SAM_SPEECH].join("\n\n"),
};

/** Captured text for p1 lines 1–8. */
const CAPTURE_P1 = {
  markdown: [`## ${DINER}`, RAIN, BELL, "### MAYA", `> ${MAYA_SPEECH}`].join("\n\n"),
  plainText: [DINER, RAIN, BELL, "MAYA", MAYA_SPEECH].join("\n\n"),
};

/** Captured text for p3 lines 1–4. */
const CAPTURE_P3 = {
  markdown: [`## ${PARKING_LOT}`, HEADLIGHTS, CAB].join("\n\n"),
  plainText: [PARKING_LOT, HEADLIGHTS, CAB].join("\n\n"),
};

/** p1 line 1 through p2 line 4 once the estimated action margin moves to x=72. */
const MARGIN_SHIFTED_MARKDOWN = [
  `> ${DINER}`,
  "Rain streaks the windows of an empty roadside diner at",
  "midnight. MAYA, thirties, wipes the counter in slow circles.",
  "A bell over the door rings. SAM steps in from the storm,",
  "shaking water from a battered canvas coat and hat.",
  "### MAYA",
  `> ${MAYA_SPEECH}`,
  "SAM",
  "(quietly)",
  "Then coffee. And the booth",
  "by the window.",
].join("\n\n");

/** Plain text for the same range and margin. */
const MARGIN_SHIFTED_PLAIN = [
  DINER,
  "Rain streaks the windows of an empty roadside diner at",
  "midnight. MAYA, thirties, wipes the counter in slow circles.",
  "A bell over the door rings. SAM steps in from the storm,",
  "shaking water from a battered canvas coat and hat.",
  "MAYA",
  MAYA_SPEECH,
  "SAM",
  "(quietly)",
  "Then coffee. And the booth",
  "by the window.",
].join("\n\n");

const AI_MARKDOWN = "## INT. ROADSIDE DINER - NIGHT\n\nRain streaks the windows while Maya wipes the counter.";

// Version-2 anchor geometry entries, as the page saves them.
const GEOMETRY = {
  p1Line1: { kind: "start", version: 2, unit: "pt", page: 1, line: 0, top: 86.2, bottom: 98.9, text: DINER },
  p1Line5: {
    kind: "end",
    version: 2,
    unit: "pt",
    page: 1,
    line: 4,
    top: 158.2,
    bottom: 170.9,
    text: "shaking water from a battered canvas coat and hat.",
  },
  p2Line4: { kind: "end", version: 2, unit: "pt", page: 2, line: 3, top: 122.2, bottom: 134.9, text: "by the window." },
  p3Line1: { kind: "start", version: 2, unit: "pt", page: 3, line: 0, top: 86.2, bottom: 98.9, text: PARKING_LOT },
  p3Line5: { kind: "end", version: 2, unit: "pt", page: 3, line: 4, top: 158.2, bottom: 170.9, text: NOBODY },
};

const V2_TIMING = "00:10:00 – 00:11:00";
const OTHER_TIMING = "00:05:00 – 00:06:00";
const LEGACY_TIMING = "00:02:00 – 00:03:00";
const DISCARD_PROMPT = "Discard unsaved changes to the current scene?";
const RECAPTURE_PROMPT = "Replace the current text with a fresh capture from the anchors? Your text edits will be lost.";
const STALE_SAVE_PROMPT =
  "This scene text doesn't match the current anchors. Save it anyway? The scene keeps this text, but its script location and raw text will come from the current anchors. To save the text between the anchors instead, cancel and re-capture.";
const ANCHORS_MOVED = "The anchors moved after this text was captured.";
const LEGACY_WORDING = "This scene was saved before screenplay formatting.";
const PROPOSAL_READY = "An AI formatting proposal is ready. Nothing changes until you accept it.";
const SNAPSHOTS = { pageImages: [{ page: 1, dataUrl: "data:image/jpeg;base64,AA==" }], omittedPageCount: 0 };

// ---------- Local helpers ----------

function inPanel() {
  return within(annotator());
}

function inDialog() {
  return within(editorDialog());
}

function click(element) {
  fireEvent.click(element);
}

function publishWholeScript() {
  return publishPages(SCRIPT_PAGES, { total: 3, complete: true });
}

function openEditor() {
  click(inPanel().getByRole("button", { name: "Expand & edit" }));
  return editorDialog();
}

function closeEditor() {
  click(inDialog().getByRole("button", { name: "Done" }));
}

function eyebrow() {
  return inPanel().getByText(/^(New scene|Editing saved scene)$/, { selector: "p" }).textContent;
}

function sceneTitle() {
  return inPanel().getByRole("heading", { level: 2 }).textContent;
}

function toast(text) {
  return screen.getByText(text, { selector: "span" });
}

function lastSavePayload() {
  const entry = pending.saves[pending.saves.length - 1];
  return entry.args[entry.args.length - 1];
}

async function requestAi(expectedCount) {
  click(inPanel().getByRole("button", { name: "Format with AI" }));
  await waitFor(() => expect(pending.formats).toHaveLength(expectedCount));
}

beforeEach(() => {
  resetHarness();
  captureAnchoredRange.mockClear();
});

// ---------- P1–P3: capture and indexing ----------

describe("capturing a new scene draft", () => {
  it("P1 [B1–B3, B7, C1, D1, F2, I3] captures text between key-placed anchors and saves the script location", async () => {
    await renderViewer(ScriptViewerRoute);
    publishPages([page1, page2], { total: 3 });

    // B1: timing is validated before text, and nothing is sent.
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(toast("Enter a start and an end time for this scene.")).toBeTruthy();
    typeTime("Start", "00:10:00");
    typeTime("End", "00:11:00");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(toast("Place start and end anchors in the script to capture the scene text.")).toBeTruthy();
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();

    placeAnchorsWithKeys([1, 0], [2, 3]);
    expect(inPanel().getByText("Start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("End · p. 2 · line 4")).toBeTruthy();
    expect(frameProps(1).startAnchor).toMatchObject({ page: 1, line: 0 });
    expect(frameProps(2).endAnchor).toMatchObject({ page: 2, line: 3 });
    expect(inPanel().getByText("Captured from PDF")).toBeTruthy();
    expect(inPanel().getByText(MAYA_SPEECH)).toBeTruthy();
    expect(inPanel().getByText(SAM_SPEECH)).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(fakeApi.createScriptScene).toHaveBeenCalledTimes(1);
    const [movieId, scriptId, payload] = pending.saves[0].args;
    expect([movieId, scriptId]).toEqual(["m1", "s1"]);
    expect(payload).toEqual({
      start_time_seconds: 600,
      end_time_seconds: 660,
      selected_text: CAPTURE_P1_TO_P2.markdown,
      raw_selected_text: CAPTURE_P1_TO_P2.plainText,
      formatted_selected_text: CAPTURE_P1_TO_P2.markdown,
      page_start: 1,
      page_end: 2,
      // B7: offsets stay null until indexing completes.
      start_offset: null,
      end_offset: null,
      context_prefix: null,
      context_suffix: `${POURS}\nCUT TO:`,
      anchor_geometry: [GEOMETRY.p1Line1, GEOMETRY.p2Line4],
      tags: [],
    });
    expect(payload.raw_selected_text).not.toMatch(/^(#|>|<p)/m);
    expect(inPanel().getByRole("button", { name: "Saving…" }).disabled).toBe(true);

    await settle(pending.saves[0]);
    expect(toast("Scene saved.")).toBeTruthy();
    expect(eyebrow()).toBe("Editing saved scene");
    expect(sceneTitle()).toBe(V2_TIMING);
    expect(inPanel().getByRole("button", { name: "Update scene" })).toBeTruthy();
    expect(inPanel().getByText("Saved")).toBeTruthy();
    expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
    expect(sceneCard(V2_TIMING)).toBeTruthy();
  });

  it("P2 [C1, C2, B7] waits for every page in the range to be indexed, then saves integer offsets once complete", async () => {
    await renderViewer(ScriptViewerRoute);
    publishPages([page1, page3], { total: 3 });

    placeAnchorsWithKeys([1, 1], [3, 2]);
    expect(inPanel().getByText("Capturing text between the anchors…")).toBeTruthy();
    expect(inPanel().getByRole("tab", { name: /^Tags/ }).disabled).toBe(true);
    expect(inPanel().queryByText("Captured from PDF")).toBeNull();

    publishPages([page1, page2, page3], { total: 3 });
    expect(inPanel().getByText(HEADLIGHTS)).toBeTruthy();
    expect(inPanel().getByRole("tab", { name: /^Tags/ }).disabled).toBe(false);

    publishWholeScript();
    typeTime("Start", "00:01:00");
    typeTime("End", "00:02:00");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(lastSavePayload()).toMatchObject({ page_start: 1, page_end: 3, start_offset: 19, end_offset: 562 });
  });

  describe("P3 [C3] captured text that changes while indexing", () => {
    // Anchors on p1 line 1 and p2 line 4. Publishing marginShiftPage moves the
    // estimated action margin from x=108 to x=72, which reclassifies that range.
    const SHIFTED_RAIN_LINE = "Rain streaks the windows of an empty roadside diner at";
    const EDITED_HEADING = "INT. DINER - LATE NIGHT";
    const EDITED_MARKDOWN = CAPTURE_P1_TO_P2.markdown.replace(`## ${DINER}`, `## ${EDITED_HEADING}`);

    function publishMarginShift({ complete = false } = {}) {
      return publishPages([page1, page2, page3, marginShiftPage], { total: 4, complete });
    }

    async function openEditorBeforeMarginShift() {
      await renderViewer(ScriptViewerRoute, { numPages: 4 });
      publishPages([page1, page2], { total: 4 });
      placeAnchorsWithKeys([1, 0], [2, 3]);
      openEditor();
      expect(editorBlock(1).value).toBe(DINER);
      expect(editorBlock(2).value).toBe(RAIN);
    }

    // jsdom tracks focus and selection, but not real caret rendering.
    function focusAt(field, caret) {
      act(() => {
        field.focus();
        field.setSelectionRange(caret, caret);
      });
    }

    function editorFields() {
      return inDialog().getAllByRole("textbox", { name: /, block \d+$/ });
    }

    /** Reads the Markdown source, then switches back to Script mode. */
    function markdownSource() {
      click(inDialog().getByRole("radio", { name: "Markdown" }));
      const { value } = inDialog().getByRole("textbox", { name: "Screenplay markdown source" });
      click(inDialog().getByRole("radio", { name: "Script" }));
      return value;
    }

    function saveWithTimes() {
      typeTime("Start", "00:01:00");
      typeTime("End", "00:02:00");
      click(inPanel().getByRole("button", { name: "Save scene" }));
      return lastSavePayload();
    }

    it("replaces an untouched script editor's text when indexing reclassifies it, keeping focus in the same block", async () => {
      await openEditorBeforeMarginShift();
      const field = editorBlock(2);
      focusAt(field, 5);
      expect(inPanel().queryByText(SHIFTED_RAIN_LINE)).toBeNull();

      publishMarginShift();

      expect(editorBlock(2)).not.toBe(field);
      expect(editorFields()).toHaveLength(11);
      expect(inDialog().getByRole("textbox", { name: "Dialogue, block 1" }).value).toBe(DINER);
      expect(editorBlock(2).value).toBe(SHIFTED_RAIN_LINE);
      expect(document.activeElement).toBe(editorBlock(2));
      expect(editorBlock(2).selectionStart).toBe(5);
      expect(inPanel().getByText(SHIFTED_RAIN_LINE)).toBeTruthy();
      expect(inPanel().getByText("Captured from PDF")).toBeTruthy();

      expect(markdownSource()).toBe(MARGIN_SHIFTED_MARKDOWN);
      expect(editorBlock(2).value).toBe(SHIFTED_RAIN_LINE);
      closeEditor();
      openEditor();
      expect(editorBlock(2).value).toBe(SHIFTED_RAIN_LINE);
      closeEditor();

      expect(saveWithTimes()).toMatchObject({
        selected_text: MARGIN_SHIFTED_MARKDOWN,
        formatted_selected_text: MARGIN_SHIFTED_MARKDOWN,
        raw_selected_text: MARGIN_SHIFTED_PLAIN,
        start_offset: null,
        end_offset: null,
      });
    });

    it("keeps the script editor, focus and caret when published indexes don't change the captured text, then saves offsets", async () => {
      await renderViewer(ScriptViewerRoute);
      publishPages([page1, page2], { total: 3 });
      placeAnchorsWithKeys([1, 0], [2, 3]);
      openEditor();
      const field = editorBlock(2);
      focusAt(field, 5);

      publishPages([page1, page2, page3], { total: 3 });
      publishWholeScript();

      expect(editorBlock(2)).toBe(field);
      expect(document.activeElement).toBe(field);
      expect(field.selectionStart).toBe(5);
      fireEvent.change(field, { target: { value: `${RAIN} Thunder.` } });
      expect(editorBlock(2)).toBe(field);
      expect(document.activeElement).toBe(field);
      expect(inPanel().getByText("Edited")).toBeTruthy();
      closeEditor();

      expect(saveWithTimes()).toMatchObject({
        selected_text: CAPTURE_P1_TO_P2.markdown.replace(RAIN, `${RAIN} Thunder.`),
        raw_selected_text: CAPTURE_P1_TO_P2.plainText,
        start_offset: 0,
        end_offset: 355,
      });
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it.each([
      {
        when: "after the first keystroke",
        typeThenShift: (field) => {
          fireEvent.change(field, { target: { value: EDITED_HEADING } });
          publishMarginShift();
        },
      },
      {
        when: "in the same batch as the first keystroke",
        typeThenShift: (field) => {
          act(() => {
            fireEvent.change(field, { target: { value: EDITED_HEADING } });
            publishMarginShift();
          });
        },
      },
    ])("keeps manual edits made $when when indexing reclassifies the captured text", async ({ typeThenShift }) => {
      await openEditorBeforeMarginShift();
      const field = editorBlock(1);
      focusAt(field, DINER.length);

      typeThenShift(field);

      expect(editorBlock(1)).toBe(field);
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe(EDITED_HEADING);
      expect(editorBlock(2).value).toBe(RAIN);
      expect(inPanel().getByText("Edited")).toBeTruthy();
      expect(inPanel().getByText(EDITED_HEADING)).toBeTruthy();
      expect(inPanel().queryByText(SHIFTED_RAIN_LINE)).toBeNull();

      expect(markdownSource()).toBe(EDITED_MARKDOWN);
      expect(editorBlock(1).value).toBe(EDITED_HEADING);
      closeEditor();
      openEditor();
      expect(editorBlock(1).value).toBe(EDITED_HEADING);
      expect(editorBlock(2).value).toBe(RAIN);
      closeEditor();

      // The anchors didn't move, so the text isn't stale; saving stores it with the reclassified capture's raw text.
      expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
      expect(saveWithTimes()).toMatchObject({
        selected_text: EDITED_MARKDOWN,
        formatted_selected_text: EDITED_MARKDOWN,
        raw_selected_text: MARGIN_SHIFTED_PLAIN,
      });
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it("re-captures reclassified text after edits once the admin confirms, and follows later anchor changes", async () => {
      await openEditorBeforeMarginShift();
      fireEvent.change(editorBlock(1), { target: { value: EDITED_HEADING } });
      publishMarginShift({ complete: true });
      expect(editorBlock(1).value).toBe(EDITED_HEADING);

      answerConfirm(true);
      click(inDialog().getByRole("button", { name: "Revert to captured text" }));
      expect(window.confirm).toHaveBeenLastCalledWith(RECAPTURE_PROMPT);
      expect(editorBlock(2).value).toBe(SHIFTED_RAIN_LINE);
      expect(inPanel().getByText("Captured from PDF")).toBeTruthy();
      expect(markdownSource()).toBe(MARGIN_SHIFTED_MARKDOWN);
      closeEditor();

      hoverLine(2, 4);
      pressKey("]");
      openEditor();
      const fields = editorFields();
      expect(fields[fields.length - 1].value).toBe(POURS);
      const source = markdownSource();
      expect(source.startsWith(MARGIN_SHIFTED_MARKDOWN)).toBe(true);
      closeEditor();

      const payload = saveWithTimes();
      expect(payload).toMatchObject({ selected_text: source, page_start: 1, page_end: 2 });
      expect(Number.isInteger(payload.start_offset) && Number.isInteger(payload.end_offset)).toBe(true);
      expect(window.confirm).toHaveBeenCalledTimes(1);
    });

    it("keeps accepted AI text, and a pending request's captured text, when indexing reclassifies the capture", async () => {
      const SECOND_AI_MARKDOWN = "## INT. DINER - NIGHT\n\nRain streaks the windows.";
      await openEditorBeforeMarginShift();

      click(inDialog().getByRole("button", { name: "Format with AI" }));
      await waitFor(() => expect(pending.formats).toHaveLength(1));
      await settle(pending.formats[0], { markdown: AI_MARKDOWN });
      click(inDialog().getByRole("button", { name: "Accept proposal" }));
      const field = editorBlock(1);
      expect(field.value).toBe("INT. ROADSIDE DINER - NIGHT");

      click(inDialog().getByRole("button", { name: "Format with AI" }));
      await waitFor(() => expect(pending.formats).toHaveLength(2));
      expect(pending.formats[1].args[0].capturedText).toBe(CAPTURE_P1_TO_P2.plainText);
      focusAt(field, 4);

      publishMarginShift();

      expect(editorBlock(1)).toBe(field);
      expect(document.activeElement).toBe(field);
      expect(field.selectionStart).toBe(4);
      expect(field.value).toBe("INT. ROADSIDE DINER - NIGHT");
      expect(inPanel().getByText("AI formatted")).toBeTruthy();
      expect(markdownSource()).toBe(AI_MARKDOWN);

      await settle(pending.formats[1], { markdown: SECOND_AI_MARKDOWN });
      click(inDialog().getByRole("button", { name: "Accept proposal" }));
      expect(editorBlock(2).value).toBe("Rain streaks the windows.");
      closeEditor();

      expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
      expect(saveWithTimes()).toMatchObject({
        selected_text: SECOND_AI_MARKDOWN,
        raw_selected_text: MARGIN_SHIFTED_PLAIN,
      });
      expect(window.confirm).not.toHaveBeenCalled();
    });
  });
});

// ---------- P4–P5: text origin, stale text, re-capture ----------

describe("editing and re-capturing scene text", () => {
  async function editCapturedTextThenMoveEndAnchor() {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);

    openEditor();
    const block = editorBlock(1);
    fireEvent.change(block, { target: { value: "INT. DINER - LATE NIGHT" } });
    closeEditor();

    hoverLine(1, 4);
    pressKey("]");
    return block;
  }

  it("P4 [D2, D6, F1, F3, F4] keeps the editor mounted on the first edit and marks the text stale when anchors move", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);

    openEditor();
    const block = editorBlock(1);
    fireEvent.change(block, { target: { value: "INT. DINER - LATE NIGHT" } });
    expect(editorBlock(1)).toBe(block);
    expect(inPanel().getByText("Edited")).toBeTruthy();
    expect(inDialog().queryByRole("button", { name: "Re-capture from anchors" })).toBeNull();
    expect(inDialog().getByRole("button", { name: "Revert to captured text" })).toBeTruthy();

    // F4: the Markdown textarea is controlled; Script mode remounts from the current text.
    click(inDialog().getByRole("radio", { name: "Markdown" }));
    const source = inDialog().getByRole("textbox", { name: "Screenplay markdown source" });
    expect(source.value.startsWith("## INT. DINER - LATE NIGHT\n\n")).toBe(true);
    fireEvent.change(source, { target: { value: `## INT. DINER - DAWN\n\n${RAIN}` } });
    click(inDialog().getByRole("radio", { name: "Script" }));
    expect(editorBlock(1).value).toBe("INT. DINER - DAWN");
    closeEditor();
    expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();

    hoverLine(1, 4);
    pressKey("]");
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();
    expect(inPanel().getByText("Edited")).toBeTruthy();
    expect(inPanel().getByText("INT. DINER - DAWN")).toBeTruthy();

    openEditor();
    expect(inDialog().getByRole("button", { name: "Re-capture from anchors" })).toBeTruthy();
    expect(editorBlock(1).value).toBe("INT. DINER - DAWN");
  });

  it("P5 [E3, D5, F2] asks before re-capture replaces edited text, from the callout and from the editor", async () => {
    await editCapturedTextThenMoveEndAnchor();

    answerConfirm(false);
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenLastCalledWith(RECAPTURE_PROMPT);
    expect(inPanel().getByText("Edited")).toBeTruthy();
    expect(inPanel().getByText("INT. DINER - LATE NIGHT")).toBeTruthy();

    openEditor();
    const block = editorBlock(1);
    answerConfirm(true);
    click(inDialog().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(window.confirm).toHaveBeenLastCalledWith(RECAPTURE_PROMPT);
    expect(inPanel().getByText("Captured from PDF")).toBeTruthy();
    expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
    expect(inPanel().getByText(BELL)).toBeTruthy();
    expect(inPanel().queryByText(MAYA_SPEECH)).toBeNull();
    expect(editorBlock(1)).not.toBe(block);
    expect(editorBlock(1).value).toBe(DINER);
  });
});

// ---------- P6–P8: saved scenes, legacy scenes, suggested anchors ----------

describe("saved and legacy scenes", () => {
  it("P6 [A1, A2, A5, A7, B4, D3, D6, E1] shows suggested anchors for a legacy scene and saves its stored location", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [legacyScene, otherScene], sceneId: legacyScene.id });

    expect(eyebrow()).toBe("Editing saved scene");
    expect(sceneTitle()).toBe(LEGACY_TIMING);
    expect(inPanel().getByText("Saved")).toBeTruthy();
    expect(inPanel().getAllByText("Not placed")).toHaveLength(2);
    expect(inPanel().queryByText(LEGACY_WORDING)).toBeNull();

    publishWholeScript();
    expect(inPanel().getByText("Suggested start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("Suggested end · p. 2 · line 6")).toBeTruthy();
    expect(inPanel().getByText(/Suggested from this scene's saved text\./)).toBeTruthy();
    expect(inPanel().getByText(LEGACY_WORDING)).toBeTruthy();
    expect(inPanel().getByText("Saved")).toBeTruthy();
    expect(frameProps(1).startAnchor).toMatchObject({ page: 1, line: 0, suggested: true });
    expect(frameProps(2).endAnchor).toMatchObject({ page: 2, line: 5, suggested: true });
    expect(frameProps(2).rangeBottom).toBe(182.9);
    // A2: suggestions aren't undo history.
    expect(inPanel().getByRole("button", { name: "Undo" }).disabled).toBe(true);
    // A5: suggestions drive the overlap warning, have no remove buttons, but the menu can remove them.
    expect(inPanel().getByText("This range overlaps the saved scene at 00:05:00.")).toBeTruthy();
    expect(inPanel().queryByRole("button", { name: "Remove the start anchor" })).toBeNull();
    expect(inPanel().queryByRole("button", { name: "Remove the end anchor" })).toBeNull();
    openLineMenu(1, 2);
    expect(menuItem(/^Remove start anchor/).disabled).toBe(false);
    expect(menuItem(/^Remove end anchor/).disabled).toBe(false);
    pressKey("Escape");
    expect(screen.queryByRole("menu", { name: "Anchor tools" })).toBeNull();

    // E1: an untouched legacy scene isn't dirty.
    click(sceneCard(OTHER_TIMING));
    expect(sceneTitle()).toBe(OTHER_TIMING);
    click(sceneCard(LEGACY_TIMING));
    expect(sceneTitle()).toBe(LEGACY_TIMING);
    expect(window.confirm).not.toHaveBeenCalled();

    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(fakeApi.updateScriptScene).toHaveBeenCalledTimes(1);
    expect(pending.saves[0].args.slice(0, 3)).toEqual(["m1", "s1", legacyScene.id]);
    expect(lastSavePayload()).toEqual({
      start_time_seconds: 120,
      end_time_seconds: 180,
      selected_text: LEGACY_RAW,
      raw_selected_text: LEGACY_RAW,
      formatted_selected_text: LEGACY_RAW,
      page_start: 1,
      page_end: 2,
      start_offset: null,
      end_offset: null,
      context_prefix: null,
      context_suffix: null,
      anchor_geometry: [],
      tags: [],
    });
  });

  it("P7 [A3, A4, E4] turns suggestions into explicit anchors on change, and brings them back when none remain", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [legacyScene, savedV2Scene], sceneId: legacyScene.id });
    publishWholeScript();

    openLineMenu(2, 4);
    click(menuItem(/^Set end anchor/));
    expect(inPanel().getByText("Start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("End · p. 2 · line 5")).toBeTruthy();
    expect(frameProps(1).startAnchor.suggested).toBeUndefined();
    expect(inPanel().getByRole("button", { name: "Undo" }).disabled).toBe(false);

    click(inPanel().getByRole("button", { name: "Undo" }));
    expect(inPanel().getByText("Suggested start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("Suggested end · p. 2 · line 6")).toBeTruthy();
    expect(inPanel().getByRole("button", { name: "Undo" }).disabled).toBe(true);

    click(inPanel().getByRole("button", { name: "Clear" }));
    expect(inPanel().getAllByText("Not placed")).toHaveLength(2);
    expect(inPanel().getByRole("button", { name: "Undo" }).disabled).toBe(true);
    expect(inPanel().getByRole("button", { name: "Clear" }).disabled).toBe(true);
    expect(inPanel().queryByText(LEGACY_WORDING)).toBeNull();

    // Loading the scene again brings suggestions back.
    click(sceneCard(V2_TIMING));
    click(sceneCard(LEGACY_TIMING));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(inPanel().getByText("Suggested start · p. 1 · line 1")).toBeTruthy();

    openLineMenu(1, 3);
    click(menuItem(/^Remove start anchor/));
    expect(inPanel().getByText("Not placed")).toBeTruthy();
    expect(inPanel().getByText("End · p. 2 · line 6")).toBeTruthy();
    expect(inPanel().getByRole("button", { name: "Undo" }).disabled).toBe(false);

    click(inPanel().getByRole("button", { name: "Remove the end anchor" }));
    expect(inPanel().getByText("Suggested start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("Suggested end · p. 2 · line 6")).toBeTruthy();

    // Re-capture from suggestions makes both anchors explicit, without a prompt for saved text.
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(inPanel().getByText("Start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("End · p. 2 · line 6")).toBeTruthy();
    expect(inPanel().getByText("Captured from PDF")).toBeTruthy();
    expect(inPanel().getByText(POURS)).toBeTruthy();
  });

  it("[D6] edited legacy text shows the anchors-moved wording", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [legacyScene], sceneId: legacyScene.id });
    publishWholeScript();
    expect(inPanel().getByText(LEGACY_WORDING)).toBeTruthy();

    openEditor();
    fireEvent.change(editorBlock(1), { target: { value: "INT. DINER - LATER" } });
    closeEditor();

    expect(inPanel().getByText("Edited")).toBeTruthy();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();
    expect(inPanel().queryByText(LEGACY_WORDING)).toBeNull();
  });

  it("P8 [A7, D3, E3, F2] loads a saved scene's anchors and reverts its text to captured text without a prompt", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });

    expect(inPanel().getByText("Start · p. 3 · line 1")).toBeTruthy();
    expect(inPanel().getByText("End · p. 3 · line 4")).toBeTruthy();
    expect(inPanel().getByText("Saved")).toBeTruthy();
    expect(inPanel().getByRole("button", { name: "Undo" }).disabled).toBe(true);

    publishWholeScript();
    expect(inPanel().getByText("Saved")).toBeTruthy();
    expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
    expect(inPanel().queryByText(LEGACY_WORDING)).toBeNull();

    openEditor();
    expect(inDialog().getByText("Editing saved scene · Page 3")).toBeTruthy();
    const block = editorBlock(1);
    expect(editorBlock(2).value).toBe("A truck idles in the lot while someone watches the diner.");

    click(inDialog().getByRole("button", { name: "Revert to captured text" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(inPanel().getByText("Captured from PDF")).toBeTruthy();
    expect(editorBlock(1)).not.toBe(block);
    expect(editorBlock(2).value).toBe(HEADLIGHTS);
    expect(inDialog().queryByRole("button", { name: "Revert to captured text" })).toBeNull();
  });
});

// ---------- P9–P10: dirty check, prompts, keys ----------

describe("discard prompts and keyboard", () => {
  const still = { id: "still-1", movie_id: "m1", time_seconds: 620, image_key: "stills/one.jpg", thumb_key: null };

  it("P9 [E2] asks before discarding a dirty draft wherever another scene, still or tag search would replace it", async () => {
    await renderViewer(ScriptViewerRoute, {
      scenes: [savedV2Scene, otherScene],
      stills: [still],
      sceneId: savedV2Scene.id,
    });
    publishWholeScript();
    expect(window.confirm).not.toHaveBeenCalled();

    typeTime("Start", "00:10:01");

    // Re-selecting the current scene only scrolls.
    click(sceneCard(V2_TIMING));
    expect(window.confirm).not.toHaveBeenCalled();

    const prompts = [
      () => click(inPanel().getByRole("button", { name: "New scene" })),
      () => click(sceneCard(OTHER_TIMING)),
      () => clickSceneBar(2, otherScene.id),
      () => {
        openLineMenu(2, 1);
        click(menuItem("Edit scene 00:05:00 – 00:06:00"));
      },
    ];
    for (const [index, prompt] of prompts.entries()) {
      answerConfirm(false);
      prompt();
      expect(window.confirm).toHaveBeenCalledTimes(index + 1);
      expect(window.confirm).toHaveBeenLastCalledWith(DISCARD_PROMPT);
      expect(sceneTitle()).toBe(V2_TIMING);
    }

    // The overlap callout's "Edit that scene".
    hoverLine(2, 2);
    pressKey("[");
    expect(inPanel().getByText("This range overlaps the saved scene at 00:05:00.")).toBeTruthy();
    answerConfirm(false);
    click(inPanel().getByRole("button", { name: "Edit that scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(5);
    expect(sceneTitle()).toBe(V2_TIMING);

    // The scene viewer: a tag search, the first still, and "Edit scene" on another scene.
    fireEvent.doubleClick(sceneCard(V2_TIMING));
    const viewer = within(screen.getByRole("dialog"));
    answerConfirm(false);
    click(viewer.getByRole("button", { name: "Protagonist" }));
    expect(window.confirm).toHaveBeenCalledTimes(6);
    answerConfirm(false);
    click(await viewer.findByRole("button", { name: "Open first still" }));
    expect(window.confirm).toHaveBeenCalledTimes(7);
    click(viewer.getByRole("button", { name: "Previous" }));
    answerConfirm(false);
    click(viewer.getByRole("button", { name: "Edit scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(8);
    expect(window.confirm).toHaveBeenLastCalledWith(DISCARD_PROMPT);
    expect(sceneTitle()).toBe(V2_TIMING);
    expect(currentLocation()).toBe("/movies/m1/scripts/s1?sceneId=scene-v2");
  });

  it("P9 [E1] counts tag order in the dirty check", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene, otherScene], sceneId: savedV2Scene.id });
    publishWholeScript();

    function retoggle(category, tag) {
      click(inPanel().getByRole("tab", { name: /^Tags/ }));
      click(inPanel().getByRole("button", { name: `Remove ${tag}` }));
      click(inPanel().getByRole("button", { name: new RegExp(`^${category}`) }));
      click(inPanel().getByRole("checkbox", { name: tag }));
    }

    // Toggling the last tag off and on keeps the order: not dirty.
    retoggle("Conflict Type", "Character vs Self");
    click(sceneCard(OTHER_TIMING));
    expect(sceneTitle()).toBe(OTHER_TIMING);
    expect(window.confirm).not.toHaveBeenCalled();

    click(sceneCard(V2_TIMING));
    expect(inPanel().getByRole("tab", { name: /^Capture/ }).getAttribute("aria-selected")).toBe("true");

    // Toggling the first tag off and on moves it to the end: dirty.
    retoggle("Character Focus", "Protagonist");
    answerConfirm(false);
    click(inPanel().getByRole("button", { name: "New scene" }));
    expect(window.confirm).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(sceneTitle()).toBe(V2_TIMING);
  });

  it("P9 [E2] deleting and top-bar project navigation don't ask to discard", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    publishWholeScript();
    typeTime("Start", "00:10:01");

    answerConfirm(false);
    click(inPanel().getByRole("button", { name: "Delete" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenLastCalledWith("Delete the scene at 00:10:00 – 00:11:00? This can't be undone.");
    expect(fakeApi.deleteScriptScene).not.toHaveBeenCalled();

    click(screen.getByRole("button", { name: "Project" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(currentLocation()).toBe("/movies/m1");
  });

  it("P9 [E2] top-bar script search doesn't ask to discard", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    typeTime("Start", "00:10:01");

    click(screen.getByRole("button", { name: "Search all scripts" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(currentLocation()).toBe("/script-search");
  });

  it("P10 [E4, E5] undoes and places anchors from the keyboard only when nothing else has focus", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();

    // With empty history the shortcut isn't prevented.
    expect(pressKey("z", { metaKey: true })).toBe(true);

    hoverLine(1, 0);
    expect(pressKey("[")).toBe(false);
    hoverLine(1, 7);
    expect(pressKey("]")).toBe(false);
    hoverLine(1, 4);
    expect(pressKey("]", { altKey: true })).toBe(true);
    expect(pressKey("]", { ctrlKey: true })).toBe(true);
    expect(inPanel().getByText("End · p. 1 · line 8")).toBeTruthy();
    expect(pressKey("]")).toBe(false);
    expect(inPanel().getByText("End · p. 1 · line 5")).toBeTruthy();

    expect(pressKey("z", { ctrlKey: true })).toBe(false);
    expect(inPanel().getByText("End · p. 1 · line 8")).toBeTruthy();
    expect(pressKey("Z", { metaKey: true, shiftKey: true })).toBe(true);
    expect(pressKey("z", { metaKey: true, altKey: true })).toBe(true);
    expect(inPanel().getByText("End · p. 1 · line 8")).toBeTruthy();

    openEditor();
    expect(pressKey("z", { metaKey: true })).toBe(true);
    closeEditor();
    expect(inPanel().getByText("End · p. 1 · line 8")).toBeTruthy();

    expect(pressKey("z", { ctrlKey: true }, timeInput("Start"))).toBe(true);
    expect(inPanel().getByText("End · p. 1 · line 8")).toBeTruthy();

    openLineMenu(1, 2);
    hoverLine(1, 3);
    expect(pressKey("[")).toBe(true);
    pressKey("Escape");
    expect(inPanel().getByText("Start · p. 1 · line 1")).toBeTruthy();

    expect(pressKey("z", { metaKey: true })).toBe(false);
    expect(inPanel().getByText("Not placed")).toBeTruthy();

    typeTime("Start", "1:05");
    fireEvent.blur(timeInput("Start"));
    expect(timeInput("Start").value).toBe("00:01:05");
    typeTime("End", "abc");
    fireEvent.blur(timeInput("End"));
    expect(timeInput("End").value).toBe("abc");
  });
});

// ---------- P11–P13: AI proposals ----------

describe("AI proposals", () => {
  it("P11 [G1, G3, G4, H1, D4, F2] requests a proposal from the anchors in effect and accepts or discards it", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    expect(inPanel().queryByRole("button", { name: "Format with AI" })).toBeNull();
    placeAnchorsWithKeys([1, 0], [1, 7]);

    await requestAi(1);
    expect(renderSelectionSnapshots).toHaveBeenCalledTimes(1);
    expect(renderSelectionSnapshots).toHaveBeenCalledWith(loadedPdfDocument(), {
      start: { page: 1, line: 0, top: 86.2, bottom: 98.9, text: DINER },
      end: { page: 1, line: 7, top: 206.2, bottom: 218.9, text: "Coffee is all I can do." },
    });
    expect(pending.formats[0].args).toEqual([
      { capturedText: CAPTURE_P1.plainText, draftMarkdown: CAPTURE_P1.markdown, pageStart: 1, pageEnd: 1, ...SNAPSHOTS },
    ]);
    expect(inPanel().getByRole("button", { name: "Formatting…" }).disabled).toBe(true);
    openEditor();
    expect(inDialog().getByRole("button", { name: "Formatting…" }).disabled).toBe(true);
    closeEditor();

    await settle(pending.formats[0], { markdown: AI_MARKDOWN });
    expect(inPanel().getByText(PROPOSAL_READY)).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Review" }));
    const block = editorBlock(1);
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    expect(inPanel().getByText("AI formatted")).toBeTruthy();
    expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
    expect(inPanel().queryByText(PROPOSAL_READY)).toBeNull();
    expect(editorBlock(1)).not.toBe(block);
    expect(editorBlock(1).value).toBe("INT. ROADSIDE DINER - NIGHT");
    closeEditor();

    await requestAi(2);
    expect(pending.formats[1].args[0]).toMatchObject({ capturedText: CAPTURE_P1.plainText, draftMarkdown: AI_MARKDOWN });
    await settle(pending.formats[1], { markdown: "## SOMETHING ELSE" });
    click(inPanel().getByRole("button", { name: "Review" }));
    click(inDialog().getByRole("button", { name: "Discard proposal" }));
    expect(inPanel().queryByText(PROPOSAL_READY)).toBeNull();
    expect(inPanel().getByText("AI formatted")).toBeTruthy();
    expect(editorBlock(1).value).toBe("INT. ROADSIDE DINER - NIGHT");
  });

  it("P11 [G1, G4] starts no request when there is no captured text and the draft text is blank", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });

    openEditor();
    click(inDialog().getByRole("radio", { name: "Markdown" }));
    fireEvent.change(inDialog().getByRole("textbox", { name: "Screenplay markdown source" }), {
      target: { value: "" },
    });
    expect(inPanel().queryByRole("button", { name: "Format with AI" })).toBeNull();

    click(inDialog().getByRole("button", { name: "Format with AI" }));
    await flush();
    expect(renderSelectionSnapshots).not.toHaveBeenCalled();
    expect(fakeApi.formatScreenplaySelection).not.toHaveBeenCalled();
    expect(inDialog().getByRole("button", { name: "Format with AI" }).disabled).toBe(false);
  });

  it("P12 [G2, H1] applies only the latest request's result", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);

    await requestAi(1);
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "New scene" }));
    expect(window.confirm).toHaveBeenCalledWith(DISCARD_PROMPT);
    placeAnchorsWithKeys([3, 0], [3, 3]);
    expect(inPanel().getByRole("button", { name: "Format with AI" }).disabled).toBe(false);

    await requestAi(2);
    expect(pending.formats[1].args[0]).toEqual({
      capturedText: CAPTURE_P3.plainText,
      draftMarkdown: CAPTURE_P3.markdown,
      pageStart: 3,
      pageEnd: 3,
      ...SNAPSHOTS,
    });

    await settle(pending.formats[0], { markdown: "## FROM THE OLD DRAFT" });
    await flush();
    expect(inPanel().queryByText(PROPOSAL_READY)).toBeNull();
    expect(inPanel().getByRole("button", { name: "Formatting…" })).toBeTruthy();

    await settle(pending.formats[1], { markdown: AI_MARKDOWN });
    expect(inPanel().getByText(PROPOSAL_READY)).toBeTruthy();

    await requestAi(3);
    expect(inPanel().queryByText(PROPOSAL_READY)).toBeNull();
    await fail(
      pending.formats[2],
      new ApiError("POST /api/script-scenes/format failed: 503", {
        status: 503,
        body: { error: "The formatter is busy. Try again soon." },
      })
    );
    expect(inPanel().getByText("The formatter is busy. Try again soon.")).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Dismiss" }));
    expect(inPanel().queryByText("The formatter is busy. Try again soon.")).toBeNull();

    typeTime("Start", "00:20:00");
    typeTime("End", "00:21:00");
    await requestAi(4);
    click(inPanel().getByRole("button", { name: "Save scene" }));
    await settle(pending.saves[0]);
    expect(toast("Scene saved.")).toBeTruthy();
    expect(inPanel().getByRole("button", { name: "Format with AI" }).disabled).toBe(false);

    await settle(pending.formats[3], { markdown: "## TOO LATE" });
    await flush();
    expect(inPanel().queryByText(PROPOSAL_READY)).toBeNull();
    expect(inPanel().getByRole("button", { name: "Format with AI" }).disabled).toBe(false);
  });

  it("P13 [H2] keeps a proposal's requested selection and word check when the anchors move while it is pending", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);

    await requestAi(1);
    expect(pending.formats[0].args[0].capturedText).toBe(CAPTURE_P1.plainText);
    hoverLine(1, 4);
    pressKey("]");
    // The formatter returns exactly the words it was sent, which the moved capture no longer has.
    await settle(pending.formats[0], { markdown: CAPTURE_P1.markdown });

    click(inPanel().getByRole("button", { name: "Review" }));
    expect(inDialog().getByText(/^AI proposal: [\d,]+ captured words match by count/)).toBeTruthy();
    expect(inDialog().getByText(/^Draft: [\d,]+ captured words match by count/)).toBeTruthy();
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    expect(inDialog().getByRole("button", { name: "Re-capture from anchors" })).toBeTruthy();
    expect(inDialog().getByText("The word check runs once text is captured from anchors.")).toBeTruthy();
    closeEditor();
    expect(inPanel().getByText("AI formatted")).toBeTruthy();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();
  });

  it("P13 [H2] marks an accepted proposal stale when the anchors moved after it was ready", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);

    await requestAi(1);
    await settle(pending.formats[0], { markdown: CAPTURE_P1.markdown });
    hoverLine(1, 4);
    pressKey("]");
    expect(inPanel().getByText(PROPOSAL_READY)).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Review" }));
    expect(inDialog().getByText(/^AI proposal: [\d,]+ captured words match by count/)).toBeTruthy();
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    closeEditor();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();

    // Returning to the requested selection makes the accepted text fresh again.
    hoverLine(1, 7);
    pressKey("]");
    expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
    expect(inPanel().getByText("AI formatted")).toBeTruthy();
  });
});

// ---------- P14–P17: compatibility behavior around saving and deleting ----------

describe("saving and deleting", () => {
  it("P14 [B5] asks for a removed anchor instead of saving the stored location, sends nothing, and keeps the draft", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    publishWholeScript();

    openLineMenu(3, 1);
    click(menuItem(/^Remove end anchor/));
    typeTime("End", "00:11:30");
    click(inPanel().getByRole("button", { name: "Update scene" }));

    expect(toast("Place an end anchor in the script before saving.")).toBeTruthy();
    expect(fakeApi.updateScriptScene).not.toHaveBeenCalled();
    expect(inPanel().getByText("Start · p. 3 · line 1")).toBeTruthy();
    expect(inPanel().getByText("Not placed")).toBeTruthy();
    expect(timeInput("End").value).toBe("00:11:30");
    expect(inPanel().getByText("Saved")).toBeTruthy();

    hoverLine(3, 4);
    pressKey("]");
    // The end anchor is back on another line than the saved text's, so that text is stale (B6).
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.updateScriptScene).toHaveBeenCalledTimes(1);
    expect(lastSavePayload()).toMatchObject({
      end_time_seconds: 690,
      page_start: 3,
      page_end: 3,
      start_offset: 419,
      end_offset: 681,
      anchor_geometry: [GEOMETRY.p3Line1, GEOMETRY.p3Line5],
    });
  });

  it("P14 [B5] asks to wait for the range's pages to index, then saves before the whole script is indexed", async () => {
    await renderViewer(ScriptViewerRoute);
    publishPages([page1, page3], { total: 3 });
    placeAnchorsWithKeys([1, 0], [3, 3]);
    expect(inPanel().getByText("Capturing text between the anchors…")).toBeTruthy();

    // Timing is still checked first.
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(toast("Enter a start and an end time for this scene.")).toBeTruthy();
    typeTime("Start", "00:01:00");
    typeTime("End", "00:02:00");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(toast("Wait for the pages between the anchors to finish indexing, then save again.")).toBeTruthy();
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();
    expect(inPanel().getByText("Start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("End · p. 3 · line 4")).toBeTruthy();

    publishPages([page1, page2, page3], { total: 3 });
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(fakeApi.createScriptScene).toHaveBeenCalledTimes(1);
    expect(lastSavePayload()).toMatchObject({
      start_time_seconds: 60,
      end_time_seconds: 120,
      page_start: 1,
      page_end: 3,
      // B7: offsets stay null until the whole script is indexed.
      start_offset: null,
      end_offset: null,
      anchor_geometry: [GEOMETRY.p1Line1, { kind: "end", page: 3, line: 3 }],
    });
  });

  it("P15 [B6] asks before saving stale Saved text with the current anchors; canceling sends nothing and keeps the draft", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    publishWholeScript();

    hoverLine(3, 4);
    pressKey("]");
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();

    // Unscripted prompts answer false, which cancels.
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.updateScriptScene).not.toHaveBeenCalled();
    expect(inPanel().getByText("Saved")).toBeTruthy();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();
    expect(inPanel().getByText("End · p. 3 · line 5")).toBeTruthy();
    expect(timeInput("Start").value).toBe("00:10:00");
    expect(inPanel().getByRole("button", { name: "Update scene" }).disabled).toBe(false);
    expect(inPanel().getByRole("button", { name: "Re-capture from anchors" })).toBeTruthy();

    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.updateScriptScene).toHaveBeenCalledTimes(1);
    // Confirming changes nothing in the draft; only the response does.
    expect(inPanel().getByText("Saved")).toBeTruthy();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();
    expect(lastSavePayload()).toEqual({
      start_time_seconds: 600,
      end_time_seconds: 660,
      selected_text: SAVED_V2_TEXT,
      raw_selected_text: [PARKING_LOT, HEADLIGHTS, `${CAB} ${NOBODY}`].join("\n\n"),
      formatted_selected_text: SAVED_V2_TEXT,
      page_start: 3,
      page_end: 3,
      start_offset: 419,
      end_offset: 681,
      context_prefix: null,
      context_suffix: null,
      anchor_geometry: [GEOMETRY.p3Line1, GEOMETRY.p3Line5],
      tags: savedV2Scene.tags,
    });

    // The response reloads the scene with text that belongs to its anchors, so the next save doesn't ask.
    await settle(pending.saves[0]);
    expect(toast("Scene updated.")).toBeTruthy();
    expect(inPanel().queryByText(ANCHORS_MOVED)).toBeNull();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(fakeApi.updateScriptScene).toHaveBeenCalledTimes(2);
    expect(lastSavePayload()).toMatchObject({
      formatted_selected_text: SAVED_V2_TEXT,
      end_offset: 681,
      anchor_geometry: [GEOMETRY.p3Line1, GEOMETRY.p3Line5],
    });
  });

  it("P15 [B6] checks timing before asking about stale Edited text, and keeps re-capture as the prompted alternative", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    openEditor();
    fireEvent.change(editorBlock(1), { target: { value: "INT. DINER - LATE NIGHT" } });
    closeEditor();
    hoverLine(1, 4);
    pressKey("]");
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(toast("Enter a start and an end time for this scene.")).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();

    typeTime("Start", "00:01:00");
    typeTime("End", "00:02:00");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();
    // The timing error no longer applies once validation passes.
    expect(screen.queryByText("Enter a start and an end time for this scene.")).toBeNull();
    expect(inPanel().getByText("Edited")).toBeTruthy();
    expect(inPanel().getByText("INT. DINER - LATE NIGHT")).toBeTruthy();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();

    // Re-capture still asks before replacing edited text.
    answerConfirm(false);
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(window.confirm).toHaveBeenLastCalledWith(RECAPTURE_PROMPT);
    expect(inPanel().getByText("Edited")).toBeTruthy();
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).toHaveBeenCalledTimes(3);
    expect(inPanel().getByText("Captured from PDF")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(3);
    expect(fakeApi.createScriptScene).toHaveBeenCalledTimes(1);
    expect(lastSavePayload()).toMatchObject({
      selected_text: [`## ${DINER}`, RAIN, BELL].join("\n\n"),
      raw_selected_text: [DINER, RAIN, BELL].join("\n\n"),
      page_start: 1,
      page_end: 1,
      anchor_geometry: [GEOMETRY.p1Line1, GEOMETRY.p1Line5],
    });
  });

  it("P15 [B6] saves confirmed stale AI formatted text, and asks again for changes made while it saves", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    typeTime("Start", "00:10:00");
    typeTime("End", "00:11:00");
    await requestAi(1);
    await settle(pending.formats[0], { markdown: AI_MARKDOWN });
    click(inPanel().getByRole("button", { name: "Review" }));
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    closeEditor();
    hoverLine(1, 4);
    pressKey("]");
    expect(inPanel().getByText("AI formatted")).toBeTruthy();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();

    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.createScriptScene).toHaveBeenCalledTimes(1);
    expect(pending.saves[0].args.slice(0, 2)).toEqual(["m1", "s1"]);
    expect(lastSavePayload()).toEqual({
      start_time_seconds: 600,
      end_time_seconds: 660,
      selected_text: AI_MARKDOWN,
      raw_selected_text: [DINER, RAIN, BELL].join("\n\n"),
      formatted_selected_text: AI_MARKDOWN,
      page_start: 1,
      page_end: 1,
      start_offset: 0,
      end_offset: 242,
      context_prefix: null,
      context_suffix: `MAYA\nKitchen closed an hour ago.\nCoffee is all I can do.`,
      anchor_geometry: [GEOMETRY.p1Line1, GEOMETRY.p1Line5],
      tags: [],
    });

    typeTime("End", "00:11:30");
    await settle(pending.saves[0]);
    expect(toast("Scene saved.")).toBeTruthy();
    expect(timeInput("End").value).toBe("00:11:30");
    expect(inPanel().getByText("AI formatted")).toBeTruthy();
    expect(inPanel().getByText(ANCHORS_MOVED)).toBeTruthy();

    // The earlier answer doesn't carry over to the changed draft.
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.updateScriptScene).not.toHaveBeenCalled();

    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(3);
    expect(pending.saves[1].args[2]).toBe("scene-new-1");
    expect(lastSavePayload()).toMatchObject({
      end_time_seconds: 690,
      formatted_selected_text: AI_MARKDOWN,
      raw_selected_text: [DINER, RAIN, BELL].join("\n\n"),
      anchor_geometry: [GEOMETRY.p1Line1, GEOMETRY.p1Line5],
    });
  });

  it("P15 [B6] doesn't ask for a legacy scene's suggested anchors, and asks once they become explicit", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [legacyScene], sceneId: legacyScene.id });
    publishWholeScript();
    expect(inPanel().getByText("Suggested end · p. 2 · line 6")).toBeTruthy();
    expect(inPanel().getByText(LEGACY_WORDING)).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(lastSavePayload()).toMatchObject({ raw_selected_text: LEGACY_RAW, page_start: 1, page_end: 2, anchor_geometry: [] });
    await settle(pending.saves[0]);

    openLineMenu(2, 4);
    click(menuItem(/^Set end anchor/));
    expect(inPanel().getByText("End · p. 2 · line 5")).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.updateScriptScene).toHaveBeenCalledTimes(1);
    expect(inPanel().getByText("End · p. 2 · line 5")).toBeTruthy();
    expect(inPanel().getByText("Saved")).toBeTruthy();
  });

  it("[I1] preserves a different draft when a save response arrives (P16)", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene, otherScene], sceneId: savedV2Scene.id });
    publishWholeScript();

    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(inPanel().getByRole("button", { name: "Saving…" }).disabled).toBe(true);
    click(sceneCard(OTHER_TIMING));
    expect(sceneTitle()).toBe(OTHER_TIMING);
    expect(window.confirm).not.toHaveBeenCalled();

    await settle(pending.saves[0]);
    expect(pending.saves[0].args[2]).toBe(savedV2Scene.id);
    expect(sceneTitle()).toBe(OTHER_TIMING);
    expect(timeInput("Start").value).toBe("00:05:00");
    expect(toast("Scene updated.")).toBeTruthy();
  });

  it("[I1] preserves edits made to the same scene during a save", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    publishWholeScript();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    typeTime("End", "00:11:30");
    await settle(pending.saves[0]);
    expect(timeInput("End").value).toBe("00:11:30");
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(lastSavePayload().end_time_seconds).toBe(690);
    expect(pending.saves[1].args[2]).toBe(savedV2Scene.id);
  });

  it("[I1] binds an edited new draft to its created scene so the next save updates it", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    typeTime("Start", "00:10:00");
    typeTime("End", "00:11:00");
    click(inPanel().getByRole("button", { name: "Save scene", exact: true }));
    typeTime("End", "00:11:30");
    await settle(pending.saves[0]);
    expect(timeInput("End").value).toBe("00:11:30");
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(fakeApi.createScriptScene).toHaveBeenCalledTimes(1);
    expect(fakeApi.updateScriptScene).toHaveBeenCalledTimes(1);
    expect(pending.saves[1].args[2]).toBe("scene-new-1");
    expect(lastSavePayload().end_time_seconds).toBe(690);
  });

  it("[I1] preserves a newly started draft when an earlier save completes", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    publishWholeScript();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    click(inPanel().getByRole("button", { name: "New scene", exact: true }));
    typeTime("Start", "00:30:00");
    await settle(pending.saves[0]);
    expect(eyebrow()).toBe("New scene");
    expect(timeInput("Start").value).toBe("00:30:00");
  });

  it("[I1] does not replace a scene that was left and reopened during its save", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene, otherScene], sceneId: savedV2Scene.id });
    publishWholeScript();
    typeTime("End", "00:11:30");
    click(inPanel().getByRole("button", { name: "Update scene" }));
    answerConfirm(true);
    click(sceneCard(OTHER_TIMING));
    click(sceneCard(V2_TIMING));
    await settle(pending.saves[0]);
    expect(timeInput("End").value).toBe("00:11:00");
  });

  it("[I2] preserves a different draft when deletion finishes (P17)", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene, otherScene], sceneId: savedV2Scene.id });
    publishWholeScript();

    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Delete" }));
    expect(pending.deletes[0].args).toEqual(["m1", "s1", savedV2Scene.id]);
    expect(inPanel().getByRole("button", { name: "Deleting…" }).disabled).toBe(true);
    click(sceneCard(OTHER_TIMING));
    expect(sceneTitle()).toBe(OTHER_TIMING);
    expect(eyebrow()).toBe("Editing saved scene");

    await settle(pending.deletes[0]);
    expect(eyebrow()).toBe("Editing saved scene");
    expect(sceneTitle()).toBe(OTHER_TIMING);
    expect(toast("Scene deleted.")).toBeTruthy();
  });

  it("[I2] clears an unchanged deleted draft", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    publishWholeScript();
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Delete", exact: true }));
    await settle(pending.deletes[0]);
    expect(eyebrow()).toBe("New scene");
    expect(timeInput("Start").value).toBe("");
  });

  it("[I2] keeps edits made during deletion as a new unsaved draft", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedV2Scene], sceneId: savedV2Scene.id });
    publishWholeScript();
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Delete", exact: true }));
    typeTime("End", "00:11:30");
    await settle(pending.deletes[0]);
    expect(eyebrow()).toBe("New scene");
    expect(timeInput("End").value).toBe("00:11:30");
    click(inPanel().getByRole("button", { name: "Save scene", exact: true }));
    expect(fakeApi.updateScriptScene).not.toHaveBeenCalled();
    expect(fakeApi.createScriptScene).toHaveBeenCalledTimes(1);
    expect(lastSavePayload().end_time_seconds).toBe(690);
    expect(lastSavePayload().formatted_selected_text).toBe(SAVED_V2_TEXT);
  });
});

// ---------- P18: performance and identity ----------

describe("P18 [R1–R3] page frame props and capture work", () => {
  const HANDLERS = ["onLineContextMenu", "onHoverLine", "onRemoveAnchor", "onSelectScene", "onRendered"];
  const UNRELATED_STABLE = [
    ...HANDLERS,
    "startAnchor",
    "endAnchor",
    "rangeTop",
    "rangeBottom",
    "pageIndex",
    "sceneSegments",
    "activeSceneId",
  ];
  const PAGES = [1, 2, 3];

  function framesNow() {
    return new Map(PAGES.map((pageNumber) => [pageNumber, frameProps(pageNumber)]));
  }

  function expectPropsKept(before, keys, pages = PAGES) {
    for (const pageNumber of pages) {
      for (const key of keys) {
        expect(frameProps(pageNumber)[key], `${key} on page ${pageNumber}`).toBe(before.get(pageNumber)[key]);
      }
    }
  }

  function captureCalls() {
    return captureAnchoredRange.mock.calls.length;
  }

  function doUnrelatedUpdates() {
    typeTime("Start", "00:00:1");
    typeTime("End", "");
    click(inPanel().getByRole("tab", { name: /^Tags/ }));
    click(inPanel().getByRole("button", { name: /^Character Focus/ }));
    click(inPanel().getByRole("checkbox", { name: "Protagonist" }));
    click(inPanel().getByRole("tab", { name: /^Capture/ }));
    openEditor();
    closeEditor();
    click(inPanel().getByRole("button", { name: /^(Save|Update) scene$/ }));
    expect(toast("Enter a start and an end time for this scene.")).toBeTruthy();
  }

  it("keeps frame props and does no capture work for time, tag, tab, dialog and notice updates", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [otherScene] });
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    const before = framesNow();
    const calls = captureCalls();

    typeTime("Start", "00:00:0");
    expect(frameProps(1)).not.toBe(before.get(1));
    doUnrelatedUpdates();

    expectPropsKept(before, UNRELATED_STABLE);
    expect(captureCalls()).toBe(calls);
  });

  it("keeps suggested anchors and capture work for a legacy scene across unrelated updates", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [legacyScene, otherScene], sceneId: legacyScene.id });
    publishWholeScript();
    const before = framesNow();
    const calls = captureCalls();
    expect(before.get(1).startAnchor.suggested).toBe(true);

    doUnrelatedUpdates();

    expectPropsKept(before, UNRELATED_STABLE);
    expect(captureCalls()).toBe(calls);
  });

  it("keeps handlers and unaffected pages' props when an end anchor moves to another page", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [otherScene] });
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    const before = framesNow();
    const calls = captureCalls();

    hoverLine(2, 4);
    pressKey("]");

    expectPropsKept(before, HANDLERS);
    // Placing an anchor copies both anchors (withoutSuggestions), so only the value is kept.
    expect(frameProps(1).startAnchor).toEqual(before.get(1).startAnchor);
    expectPropsKept(before, ["startAnchor", "endAnchor", "rangeTop", "rangeBottom"], [3]);
    expect(frameProps(2).endAnchor).toMatchObject({ page: 2, line: 4 });
    expect(captureCalls()).toBeGreaterThan(calls);
    const preview = inPanel().getByRole("button", { name: /^Night Diner, Pages 1–2,/ });
    expect(within(preview).getByText(POURS)).toBeTruthy();
  });

  it("keeps handlers and the range when anchor markers are hidden", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [otherScene] });
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [2, 3]);
    const before = framesNow();
    const calls = captureCalls();

    click(screen.getByRole("button", { name: "Hide start and end markers" }));

    expect(frameProps(1).startAnchor).toBeNull();
    expectPropsKept(before, [...HANDLERS, "rangeTop", "rangeBottom"]);
    expect(captureCalls()).toBe(calls);
  });

  it("keeps handlers when a new text index is published, and the capture stays correct", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [otherScene] });
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [2, 3]);
    const before = framesNow();

    publishWholeScript();

    expectPropsKept(before, HANDLERS);
    expect(inPanel().getByText(SAM_SPEECH)).toBeTruthy();
    typeTime("Start", "00:01:00");
    typeTime("End", "00:02:00");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(lastSavePayload()).toMatchObject({
      selected_text: CAPTURE_P1_TO_P2.markdown,
      start_offset: 0,
      end_offset: 355,
    });
  });
});

// ---------- P19: visitors ----------

describe("P19 [I4] visitors", () => {
  it("reads the script without a draft: a deep link focuses the scene and scene bars open the viewer", async () => {
    await renderViewer(ScriptViewerRoute, {
      admin: false,
      scenes: [savedV2Scene, otherScene],
      sceneId: savedV2Scene.id,
    });
    publishWholeScript();

    expect(queryAnnotator()).toBeNull();
    expect(frameProps(3).activeSceneId).toBe(savedV2Scene.id);
    expect(frameProps(3).readOnly).toBe(true);
    expect(frameProps(3).startAnchor).toBeNull();

    hoverLine(1, 0);
    expect(pressKey("[")).toBe(true);
    expect(frameProps(1).startAnchor).toBeNull();

    clickSceneBar(2, otherScene.id);
    const viewer = within(screen.getByRole("dialog"));
    expect(viewer.getByText("Page 2 · 00:05:00 – 00:06:00")).toBeTruthy();
    expect(viewer.getByRole("button", { name: "Show in script" })).toBeTruthy();
    expect(frameProps(2).activeSceneId).toBe(otherScene.id);
    expect(queryAnnotator()).toBeNull();
  });
});
