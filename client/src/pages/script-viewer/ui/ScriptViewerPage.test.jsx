import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/lib/errors.js";
import { lineBoxAt } from "@/shared/lib/pdf-text/pageTextLines.js";
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
  openLineMenu,
  pending,
  placeAnchorsWithKeys,
  pressKey,
  publishPages,
  queryAnnotator,
  renderSelectionSnapshots,
  renderViewer,
  resetHarness,
  savedScenesGrid,
  sceneCard,
  sceneRowFromPayload,
  settle,
  timeInput,
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
const AI_MARKDOWN = "## INT. ROADSIDE DINER - NIGHT\n\nRain falls while Maya wipes the counter.";
const SAVED_TIMING = "00:10:00 – 00:11:00";
const STALE_SAVE_PROMPT =
  "This scene text doesn't match the current anchors. Save it anyway? The scene keeps this text, but its script location will come from the current anchors. To save the text between the anchors instead, cancel and re-capture.";
const RECAPTURE_PROMPT = "Replace the current text with a fresh capture from the anchors? Your text edits will be lost.";

function anchorPage(kind) {
  const label = inPanel().getByText(`${kind} anchor`);
  return label.parentElement.textContent.replace(`${kind} anchor`, "");
}

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

function closeEditor() {
  click(inDialog().getByRole("button", { name: "Done" }));
}

async function requestAi(expectedCount = pending.formats.length + 1) {
  click(inPanel().getByRole("button", { name: "Format with AI" }));
  await waitFor(() => expect(pending.formats).toHaveLength(expectedCount));
  return pending.formats[expectedCount - 1];
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
      script_key: "scripts/m1/fixture.pdf",
      start_time_seconds: 60,
      end_time_seconds: 120,
      script_location: scriptLocation(page1, 0, page2, 3),
      scene_text: CAPTURE_MARKDOWN,
      tags: [],
    });

    const response = sceneRowFromPayload("scene-created", lastSavePayload());
    await settle(pending.saves[0], response);
    expect(inPanel().getByText("Editing saved scene")).toBeTruthy();
    expect(within(savedScenesGrid()).getByText("00:01:00 – 00:02:00")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "New scene" }));
    expect(inPanel().getByText("New scene", { selector: "p" })).toBeTruthy();
    click(sceneCard("00:01:00 – 00:02:00"));

    expect(anchorPage("Start")).toBe("Page 1");
    expect(anchorPage("End")).toBe("Page 2");
    expect(inPanel().getByText(DINER)).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(2));
    expect(lastSavePayload()).toEqual(pending.saves[0].args.at(-1));
  });

  it("makes a cleared saved location unsaveable until undo restores and captures it", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    expect(anchorPage("Start")).toBe("Page 3");

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
    expect(renderSelectionSnapshots).toHaveBeenCalledWith(expect.any(Object), savedScene.script_location, expect.any(Map));

    await settle(pending.formats[0], { markdown: AI_MARKDOWN });
    expect(inPanel().getByText("An AI formatting proposal is ready. Nothing changes until you accept it.")).toBeTruthy();
    expect(inPanel().getByText("A truck idles in the lot while someone watches the diner.")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Review" }));
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toMatchObject({ scene_text: AI_MARKDOWN });
  });

  it.each([
    ["after the first edit commits", false],
    ["in the same React batch as the first edit", true],
  ])("keeps a manual edit, focus and editor identity when reclassification publishes %s", async (_, sameBatch) => {
    await renderViewer(ScriptViewerRoute, { numPages: 4 });
    publishPages([page1, page2]);
    placeAnchorsWithKeys([1, 0], [2, 3]);
    openEditor();
    const field = editorBlock(1);
    field.focus();
    field.setSelectionRange(5, 5);
    const edit = () => fireEvent.change(field, { target: { value: "INT. DINER - LATE NIGHT" } });
    const publish = () => publishPages([page1, page2, page3, marginShiftPage]);
    if (sameBatch) act(() => (edit(), publish()));
    else {
      edit();
      publish();
    }

    expect(editorBlock(1)).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("INT. DINER - LATE NIGHT");
    expect(inPanel().getByText("Edited")).toBeTruthy();
    closeEditor();
    setTiming();
    click(inPanel().getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toMatchObject({
      scene_text: expect.stringContaining("INT. DINER - LATE NIGHT"),
    });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("asks before re-capture replaces an edit and then follows later anchor changes", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    openEditor();
    fireEvent.change(editorBlock(1), { target: { value: "INT. DINER - LATE NIGHT" } });
    closeEditor();
    hoverLine(1, 4);
    pressKey("]");
    expect(inPanel().getByText("The anchors moved after this text was captured.")).toBeTruthy();

    answerConfirm(false, true);
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).toHaveBeenLastCalledWith(RECAPTURE_PROMPT);
    expect(inPanel().getByText("Edited")).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).toHaveBeenLastCalledWith(RECAPTURE_PROMPT);
    expect(inPanel().getByText("Captured from PDF")).toBeTruthy();
    expect(inPanel().getByText(BELL)).toBeTruthy();
    expect(inPanel().queryByText(MAYA_SPEECH)).toBeNull();

    hoverLine(2, 4);
    pressKey("]");
    expect(inPanel().getAllByText("Maya pours two cups and slides one across the counter.")).toHaveLength(1);
  });

  it("keeps a pending AI request's selection baseline when anchors move", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    const request = await requestAi();
    const requestedText = request.args[0].capturedText;
    hoverLine(1, 4);
    pressKey("]");
    await settle(request, { markdown: [`## ${DINER}`, RAIN, BELL, "### MAYA", `> ${MAYA_SPEECH}`].join("\n\n") });

    click(inPanel().getByRole("button", { name: "Review" }));
    expect(inDialog().getByText(/^AI proposal: [\d,]+ captured words match by count/)).toBeTruthy();
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    closeEditor();
    expect(requestedText).toContain(MAYA_SPEECH);
    expect(inPanel().getByText("AI formatted")).toBeTruthy();
    expect(inPanel().getByText("The anchors moved after this text was captured.")).toBeTruthy();
  });

  it("surfaces AI failures, dismisses them, and allows a later request", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 4]);
    const first = await requestAi();
    await fail(
      first,
      new ApiError("POST failed: 503", { status: 503, body: { error: "The formatter is busy. Try again soon." } })
    );
    expect(inPanel().getByText("The formatter is busy. Try again soon.")).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Dismiss" }));
    expect(inPanel().queryByText("The formatter is busy. Try again soon.")).toBeNull();
    await requestAi(2);
    expect(pending.formats).toHaveLength(2);
  });
});

describe("draft interaction guards", () => {
  it("places and undoes anchors by keyboard only when no editor, input, modifier or menu owns the key", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    expect(pressKey("z", { metaKey: true })).toBe(true);
    hoverLine(1, 0);
    expect(pressKey("[")).toBe(false);
    hoverLine(1, 7);
    expect(pressKey("]")).toBe(false);
    hoverLine(2, 3);
    expect(pressKey("]", { altKey: true })).toBe(true);
    expect(anchorPage("End")).toBe("Page 1");
    expect(pressKey("]")).toBe(false);
    expect(anchorPage("End")).toBe("Page 2");
    expect(pressKey("z", { ctrlKey: true })).toBe(false);
    expect(anchorPage("End")).toBe("Page 1");

    openEditor();
    expect(pressKey("z", { metaKey: true })).toBe(true);
    closeEditor();
    expect(pressKey("z", { ctrlKey: true }, timeInput("Start"))).toBe(true);
    openLineMenu(1, 2);
    hoverLine(1, 3);
    expect(pressKey("[")).toBe(true);
    pressKey("Escape");
    expect(anchorPage("Start")).toBe("Page 1");
  });

  it("keeps a dirty scene open when switching is canceled and discards it only after confirmation", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene, otherScene], sceneId: savedScene.id });
    publishWholeScript();
    typeTime("Start", "00:10:01");
    click(sceneCard("00:05:00 – 00:06:00"));
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes to the current scene?");
    expect(timeInput("Start").value).toBe("00:10:01");
    answerConfirm(true);
    click(sceneCard("00:05:00 – 00:06:00"));
    expect(timeInput("Start").value).toBe("00:05:00");
  });

  it("starts no AI request when both capture and draft text are unavailable", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    openEditor();
    click(inDialog().getByRole("radio", { name: "Markdown" }));
    fireEvent.change(inDialog().getByRole("textbox", { name: "Screenplay markdown source" }), {
      target: { value: "" },
    });
    expect(inPanel().queryByRole("button", { name: "Format with AI" })).toBeNull();
    click(inDialog().getByRole("button", { name: "Format with AI" }));
    await flush();
    expect(fakeApi.formatScreenplaySelection).not.toHaveBeenCalled();
    expect(inDialog().getByRole("button", { name: "Format with AI" }).disabled).toBe(false);
  });
});

describe("stale-text save decisions", () => {
  it("validates timing before prompting for stale edited text and keeps re-capture behind its own confirmation", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    openEditor();
    fireEvent.change(editorBlock(1), { target: { value: "INT. DINER - LATE NIGHT" } });
    closeEditor();
    hoverLine(1, 4);
    pressKey("]");

    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(screen.getByText("Enter a start and an end time for this scene.")).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
    setTiming();
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(window.confirm).toHaveBeenCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();

    answerConfirm(false, true);
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(window.confirm).toHaveBeenLastCalledWith(RECAPTURE_PROMPT);
    expect(inPanel().getByText("Edited")).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Re-capture from anchors" }));
    expect(inPanel().getByText("Captured from PDF")).toBeTruthy();
    click(inPanel().getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toMatchObject({
      script_location: scriptLocation(page1, 0, page1, 4),
      scene_text: [`## ${DINER}`, RAIN, BELL].join("\n\n"),
    });
  });

  it("asks again for stale AI text after edits made while the confirmed save is pending", async () => {
    await renderViewer(ScriptViewerRoute);
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [1, 7]);
    setTiming("00:10:00", "00:11:00");
    const format = await requestAi();
    await settle(format, { markdown: AI_MARKDOWN });
    click(inPanel().getByRole("button", { name: "Review" }));
    click(inDialog().getByRole("button", { name: "Accept proposal" }));
    closeEditor();
    hoverLine(1, 4);
    pressKey("]");

    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toMatchObject({
      scene_text: AI_MARKDOWN,
      script_location: scriptLocation(page1, 0, page1, 4),
    });
    typeTime("End", "00:11:30");
    await settle(pending.saves[0]);
    expect(timeInput("End").value).toBe("00:11:30");
    expect(inPanel().getByText("AI formatted")).toBeTruthy();

    click(inPanel().getByRole("button", { name: "Update scene" }));
    expect(window.confirm).toHaveBeenLastCalledWith(STALE_SAVE_PROMPT);
    expect(fakeApi.updateScriptScene).not.toHaveBeenCalled();
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(2));
    expect(pending.saves[1].args[2]).toBe("scene-new-1");
    expect(lastSavePayload().end_time_seconds).toBe(690);
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

  it("refuses overlapping film timing without a request, then saves timing a second clear of it", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [otherScene] });
    publishWholeScript();
    placeAnchorsWithKeys([3, 0], [3, 4]);
    setTiming("00:05:30", "00:07:00");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(
      screen.getByText(
        "This scene's film timing shares a second with the scene at 00:05:00 – 00:06:00. Scenes must be at least a second apart."
      )
    ).toBeTruthy();
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();
    typeTime("Start", "00:06:00");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();
    typeTime("Start", "00:06:01");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload()).toMatchObject({
      start_time_seconds: 361,
      end_time_seconds: 420,
      script_location: scriptLocation(page3, 0, page3, 4),
    });
  });

  it("refuses a shared boundary line and saves a location on the adjacent line", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [otherScene] });
    publishWholeScript();
    placeAnchorsWithKeys([1, 0], [2, 0]);
    setTiming();
    click(inPanel().getByRole("button", { name: "Save scene" }));
    expect(fakeApi.createScriptScene).not.toHaveBeenCalled();
    hoverLine(1, 7);
    pressKey("]");
    click(inPanel().getByRole("button", { name: "Save scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(lastSavePayload().script_location).toEqual(scriptLocation(page1, 0, page1, 7));
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

  it("preserves a different draft when an earlier save response arrives", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene, otherScene], sceneId: savedScene.id });
    publishWholeScript();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    click(sceneCard("00:05:00 – 00:06:00"));
    await settle(pending.saves[0]);
    expect(timeInput("Start").value).toBe("00:05:00");
    expect(inPanel().getByText("Editing saved scene")).toBeTruthy();
  });

  it("does not replace a scene that was left and reopened while its save was pending", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene, otherScene], sceneId: savedScene.id });
    publishWholeScript();
    typeTime("End", "00:11:30");
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    answerConfirm(true);
    click(sceneCard("00:05:00 – 00:06:00"));
    click(sceneCard(SAVED_TIMING));
    await settle(pending.saves[0]);
    expect(timeInput("End").value).toBe("00:11:00");
  });

  it("keeps a newly started draft when an earlier save completes", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    click(inPanel().getByRole("button", { name: "Update scene" }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    click(inPanel().getByRole("button", { name: "New scene", exact: true }));
    typeTime("Start", "00:30:00");
    await settle(pending.saves[0]);
    expect(inPanel().getByText("New scene", { selector: "p" })).toBeTruthy();
    expect(timeInput("Start").value).toBe("00:30:00");
  });

  it("scrolls canonical deep links to the start anchor for admins and visitors", async () => {
    for (const admin of [false, true]) {
      cleanup();
      resetHarness();
      await renderViewer(ScriptViewerRoute, { admin, scenes: [savedScene], sceneId: savedScene.id });
      expect(windowingDouble.scrollToPage).not.toHaveBeenCalled();
      publishWholeScript();
      await waitFor(() => expect(windowingDouble.scrollToPage).toHaveBeenCalled());
      expect(windowingDouble.scrollToPage).toHaveBeenLastCalledWith(
        3,
        expect.objectContaining({ offsetPt: 86.16 })
      );
      expect(Boolean(queryAnnotator())).toBe(admin);
    }
  });

  it("draws saved scene bars from the canonical location", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene, otherScene] });
    publishWholeScript();
    expect(frameProps(2).sceneSegments[0]).toMatchObject({ scene: otherScene, top: 86.16, bottom: 134.88 });
    expect(frameProps(3).sceneSegments[0]).toMatchObject({ scene: savedScene, top: 86.16, bottom: 158.88 });
  });

  it("keeps the loaded scenes in canonical location order", async () => {
    const later = sceneRow({
      ...savedScene,
      id: "later",
      start_time_seconds: 1200,
      end_time_seconds: 1260,
      scene_text: "## LATER LOCATION",
      script_location: scriptLocation(page3, 2, page3, 4),
    });
    const earlier = sceneRow({
      ...savedScene,
      id: "earlier",
      start_time_seconds: 60,
      end_time_seconds: 120,
      scene_text: "## EARLIER LOCATION",
      script_location: scriptLocation(page1, 0, page1, 4),
    });
    await renderViewer(ScriptViewerRoute, { scenes: [later, earlier] });
    const cards = within(savedScenesGrid()).getAllByRole("button");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Night Diner, EARLIER LOCATION",
      "Night Diner, LATER LOCATION",
    ]);
    expect(fakeApi.listScriptScenes).toHaveBeenCalledWith("m1", "s1");
  });
});

describe("delete races, visitor navigation and load failures", () => {
  it("preserves another open scene when deletion finishes", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene, otherScene], sceneId: savedScene.id });
    publishWholeScript();
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(pending.deletes).toHaveLength(1));
    expect(pending.deletes[0].args).toEqual(["m1", "s1", savedScene.id]);
    click(sceneCard("00:05:00 – 00:06:00"));
    await settle(pending.deletes[0]);
    expect(timeInput("Start").value).toBe("00:05:00");
    expect(inPanel().getByText("Editing saved scene")).toBeTruthy();
  });

  it("clears an unchanged deleted draft", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Delete", exact: true }));
    await waitFor(() => expect(pending.deletes).toHaveLength(1));
    await settle(pending.deletes[0]);
    expect(inPanel().getByText("New scene", { selector: "p" })).toBeTruthy();
    expect(timeInput("Start").value).toBe("");
  });

  it("keeps edits made during deletion as a new unsaved draft whose next save creates", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene], sceneId: savedScene.id });
    publishWholeScript();
    answerConfirm(true);
    click(inPanel().getByRole("button", { name: "Delete", exact: true }));
    await waitFor(() => expect(pending.deletes).toHaveLength(1));
    typeTime("End", "00:11:30");
    await settle(pending.deletes[0]);
    expect(inPanel().getByText("New scene", { selector: "p" })).toBeTruthy();
    expect(timeInput("End").value).toBe("00:11:30");
    click(inPanel().getByRole("button", { name: "Save scene", exact: true }));
    await waitFor(() => expect(pending.saves).toHaveLength(1));
    expect(fakeApi.updateScriptScene).not.toHaveBeenCalled();
    expect(fakeApi.createScriptScene).toHaveBeenCalledTimes(1);
    expect(lastSavePayload()).toMatchObject({ end_time_seconds: 690, scene_text: SAVED_TEXT });
  });

  it("lets a visitor open a canonical scene bar and show it in the script", async () => {
    await renderViewer(ScriptViewerRoute, { admin: false, scenes: [savedScene, otherScene] });
    publishWholeScript();
    expect(queryAnnotator()).toBeNull();
    clickSceneBar(2, otherScene.id);
    const dialog = within(screen.getByRole("dialog"));
    // A visitor reads film timing alone; PDF page numbers stay on admin surfaces.
    expect(dialog.getByText("00:05:00 – 00:06:00")).toBeTruthy();
    click(dialog.getByRole("button", { name: "Show in script" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(windowingDouble.scrollToPage).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({ offsetPt: lineBoxAt(otherScene.script_location.start.y).top })
    );
    expect(queryAnnotator()).toBeNull();
  });

  it("shows an API load failure instead of mounting the PDF viewer", async () => {
    fakeApi.getScript.mockRejectedValueOnce(
      new ApiError("GET /scripts failed: 503", { status: 503, body: { error: "The script service is unavailable." } })
    );
    await renderViewer(ScriptViewerRoute, { awaitPages: false });
    await waitFor(() => expect(screen.getByText("The script service is unavailable.")).toBeTruthy());
    expect(frameProps(1)).toBeNull();
    expect(screen.queryByTestId("pdf-document")).toBeNull();
    expect(loadedPdfDocument()).toMatchObject({ numPages: 3 });
    expect(currentLocation()).toBe("/movies/m1/scripts/s1");
  });
});

describe("page-frame and capture locality", () => {
  it("keeps page-frame handlers stable and does not recapture for timing edits", async () => {
    await renderViewer(ScriptViewerRoute, { scenes: [savedScene] });
    publishPages([page1, page2]);
    placeAnchorsWithKeys([1, 0], [2, 3]);
    const before = frameProps(1);
    const captureCalls = captureAnchoredRange.mock.calls.length;
    typeTime("Start", "00:01:00");
    typeTime("End", "00:02:00");
    const afterTiming = frameProps(1);
    for (const key of ["onLineContextMenu", "onHoverLine", "onRemoveAnchor", "onSelectScene", "onRendered"]) {
      expect(afterTiming[key]).toBe(before[key]);
    }
    expect(captureAnchoredRange.mock.calls.length).toBe(captureCalls);

    publishWholeScript();
    expect(captureAnchoredRange.mock.calls.length).toBeGreaterThan(captureCalls);
    const afterIndex = frameProps(1);
    for (const key of ["onLineContextMenu", "onHoverLine", "onRemoveAnchor", "onSelectScene", "onRendered"]) {
      expect(afterIndex[key]).toBe(before[key]);
    }
  });
});
