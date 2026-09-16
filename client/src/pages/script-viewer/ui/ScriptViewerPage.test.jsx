import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureAnchoredRange } from "../model/captureRange.js";
import {
  annotator,
  answerConfirm,
  editorBlock,
  editorDialog,
  fakeApi,
  frameProps,
  pending,
  placeAnchorsWithKeys,
  publishPages,
  queryAnnotator,
  renderSelectionSnapshots,
  renderViewer,
  resetHarness,
  savedScenesGrid,
  sceneCard,
  sceneRowFromPayload,
  settle,
  typeTime,
  windowingDouble,
} from "../test/pageHarness.js";
import {
  marginShiftPage,
  otherScene,
  page1,
  page2,
  page3,
  SAVED_TEXT,
  savedScene,
  sceneRow,
  SCRIPT_PAGES,
  scriptLocation,
} from "../test/textIndexFixtures.js";
import ScriptViewerRoute from "./ScriptViewerPage.jsx";

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
vi.mock("../model/captureRange.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, captureAnchoredRange: vi.fn(actual.captureAnchoredRange) };
});

const DINER = "INT. DINER - NIGHT";
const RAIN =
  "Rain streaks the windows of an empty roadside diner at midnight. MAYA, thirties, wipes the counter in slow circles.";
const BELL = "A bell over the door rings. SAM steps in from the storm, shaking water from a battered canvas coat and hat.";
const MAYA_SPEECH = "Kitchen closed an hour ago. Coffee is all I can do.";
const SAM_SPEECH = "Then coffee. And the booth by the window.";
const CAPTURE_MARKDOWN = [
  `## ${DINER}`,
  RAIN,
  BELL,
  "### MAYA",
  `> ${MAYA_SPEECH}`,
  "### SAM",
  `> > (quietly)\n>\n> ${SAM_SPEECH}`,
].join("\n\n");
const CAPTURE_PLAIN = [DINER, RAIN, BELL, "MAYA", MAYA_SPEECH, "SAM", "(quietly)", SAM_SPEECH].join("\n\n");
const AI_MARKDOWN = "## INT. ROADSIDE DINER - NIGHT\n\nRain falls while Maya wipes the counter.";
const SAVED_TIMING = "00:10:00 – 00:11:00";
const STALE_SAVE_PROMPT =
  "This scene text doesn't match the current anchors. Save it anyway? The scene keeps this text, but its script location and raw text will come from the current anchors. To save the text between the anchors instead, cancel and re-capture.";

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
  return publishPages(SCRIPT_PAGES, { complete: true });
}

function lastSavePayload() {
  return pending.saves.at(-1).args.at(-1);
}

function setTiming(start = "00:01:00", end = "00:02:00") {
  typeTime("Start", start);
  typeTime("End", end);
}

function openEditor() {
  click(inPanel().getByRole("button", { name: "Expand & edit" }));
  return editorDialog();
}

beforeEach(() => {
  resetHarness();
  captureAnchoredRange.mockClear();
});

describe("canonical capture and persistence", () => {
  it("saves the exact canonical payload, applies the API-shaped response, and reopens the scene intact", async () => {
    await renderViewer(ScriptViewerRoute);
    publishPages([page1, page2]);
    placeAnchorsWithKeys([1, 0], [2, 3]);
    setTiming();

    click(inPanel().getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toEqual({
      start_time_seconds: 60,
      end_time_seconds: 120,
      script_location: scriptLocation(page1, 0, page2, 3),
      scene_text: CAPTURE_MARKDOWN,
      raw_text: CAPTURE_PLAIN,
      tags: [],
    });

    const response = sceneRowFromPayload("scene-created", lastSavePayload());
    await settle(pending.saves[0], response);
    expect(inPanel().getByText("Editing saved scene")).toBeTruthy();
    expect(within(savedScenesGrid()).getByText("00:01:00 – 00:02:00")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "New scene" }));
    expect(inPanel().getByText("New scene", { selector: "p" })).toBeTruthy();
    click(sceneCard("00:01:00 – 00:02:00"));

    expect(inPanel().getByText("Start · p. 1 · line 1")).toBeTruthy();
    expect(inPanel().getByText("End · p. 2 · line 4")).toBeTruthy();
    expect(inPanel().getAllByText(DINER).length).toBeGreaterThanOrEqual(2);
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(2));
    expect(lastSavePayload()).toEqual(pending.saves[0].args.at(-1));
  });

  it("makes a cleared saved location unsaveable until undo restores and captures it", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    expect(inPanel().getByText("Start · p. 3 · line 1")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Clear" }));
    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(screen.getByRole("alert").textContent).toContain("Place a start anchor in the script before saving.");
    expect(fakeApi.updateScriptScene).not.toHaveBeenCalled();

    click(inPanel().getByRole("button", { name: "Undo" }));
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload().script_location).toEqual(savedScene.script_location);
  });

  it("waits for every page in the anchored range, then saves before the whole script finishes indexing", async () => {
    await renderViewer(ScriptViewerRoute);
    publishPages([page1, page3]);
    placeAnchorsWithKeys([1, 0], [3, 3]);
    setTiming();
    expect(inPanel().getByText("Capturing text between the anchors…")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(screen.getByRole("alert").textContent).toContain("Wait for the pages between the anchors");
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();

    publishPages([page1, page2, page3]);
    click(inPanel().getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload().script_location).toEqual(scriptLocation(page1, 0, page3, 3));
  });

  it("prompts once before saving stale saved text with the moved location and current raw text", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    placeAnchorsWithKeys([3, 0], [3, 4]);
    expect(inPanel().getByText("The anchors moved after this text was captured.")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenCalledWith(STALE_SAVE_PROMPT);
    expect(pending.saves).toHaveLength(0);

    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toMatchObject({
      scene_text: SAVED_TEXT,
      raw_text: expect.stringContaining("Nobody gets out"),
      script_location: scriptLocation(page3, 0, page3, 4),
    });
  });
});

describe("editor, indexing and AI", () => {
  it("keeps editor focus and caret when indexing publishes the same capture", async () => {
    await renderViewer(ScriptViewerRoute);
    publishPages([page1, page2]);
    placeAnchorsWithKeys([1, 0], [2, 3]);
    openEditor();
    const field = editorBlock(2);
    field.focus();
    field.setSelectionRange(5, 5);

    publishWholeScript();
    expect(editorBlock(2)).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(5);
  });

  it("hands focus and caret to the replacement editor when indexing reclassifies captured text", async () => {
    await renderViewer(ScriptViewerRoute, { numPages: 4 });
    publishPages([page1, page2]);
    placeAnchorsWithKeys([1, 0], [2, 3]);
    openEditor();
    const before = editorBlock(2);
    before.focus();
    before.setSelectionRange(8, 8);

    publishPages([page1, page2, page3, marginShiftPage]);
    const after = editorBlock(2);
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after.selectionStart).toBe(8);
  });

  it("keeps an AI proposal inert until acceptance and saves it as scene text", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    click(inPanel().getByRole("button", { name: "Format with AI" }));
    await waitFor(() => expect(pending.formats).toHaveLength(1));
    expect(pending.formats[0].args[0]).toMatchObject({
      capturedText: expect.stringContaining("EXT. PARKING LOT"),
      draftMarkdown: SAVED_TEXT,
      pageStart: 3,
      pageEnd: 3,
    });
    expect(renderSelectionSnapshots).toHaveBeenCalledWith(expect.any(Object), savedScene.script_location);

    await settle(pending.formats[0], { markdown: AI_MARKDOWN });
    expect(inPanel().getByText("An AI formatting proposal is ready. Nothing changes until you accept it.")).toBeTruthy();
    expect(inPanel().getByText("A truck idles in the lot while someone watches the diner.")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Review" }));
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toMatchObject({ scene_text: AI_MARKDOWN, raw_text: expect.stringContaining("EXT. PARKING LOT") });
  });
});

describe("overlap, request races and navigation", () => {
  it("shows the live overlap callout and refuses the request", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [otherScene] });
    publishWholeScript();
    placeAnchorsWithKeys([2, 0], [2, 3]);
    setTiming("00:07:00", "00:08:00");

    expect(inPanel().getByText(/These anchors share lines with the scene at 00:05:00/)).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();
  });

  it("keeps newer edits when a save response arrives", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));

    openEditor();
    fireEvent.change(editorBlock(1), { target: { value: "EXT. NEW LOCATION - NIGHT" } });
    click(inDialog().getByRole("button", { name: "Done" }));
    await settle(pending.saves[0], sceneRowFromPayload(savedScene.id, lastSavePayload()));

    expect(inPanel().getByText("EXT. NEW LOCATION - NIGHT")).toBeTruthy();
    expect(inPanel().getByText("Editing saved scene")).toBeTruthy();
  });

  it("scrolls canonical deep links to the start anchor for admins and visitors", async () => {
    for (const admin of [false, true]) {
      resetHarness();
      await renderViewer(ScriptViewerRoute, { admin, scenes: [savedScene], sceneId: savedScene.id });
      await waitFor(() => expect(windowingDouble.scrollToPage).toHaveBeenCalled());
      expect(windowingDouble.scrollToPage).toHaveBeenLastCalledWith(
        3,
        expect.objectContaining({ offsetPx: 86.2 })
      );
      expect(Boolean(queryAnnotator())).toBe(admin);
    }
  });

  it("draws saved scene bars from the canonical location", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene, otherScene] });
    expect(frameProps(2).sceneSegments[0]).toMatchObject({ scene: otherScene, top: 86.2, bottom: 134.9 });
    expect(frameProps(3).sceneSegments[0]).toMatchObject({ scene: savedScene, top: 86.2, bottom: 158.9 });
  });

  it("keeps the loaded scenes in canonical location order", async () => {
    const later = sceneRow({ ...savedScene, id: "later", script_location: scriptLocation(page3, 2, page3, 4) });
    const earlier = sceneRow({ ...savedScene, id: "earlier", script_location: scriptLocation(page1, 0, page1, 4) });
    await renderViewer(ScriptViewerRoute, { scenes: [later, earlier] });
    const timings = within(savedScenesGrid()).getAllByText(/00:10:00 – 00:11:00/);
    expect(timings).toHaveLength(2);
    expect(fakeApi.listScriptScenes).toHaveBeenCalledWith("m1", "s1");
  });
});
