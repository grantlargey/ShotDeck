import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";
import { sceneRow, textIndexFrom } from "./textIndexFixtures.js";

/*
 * Doubles and helpers for the ScriptViewerPage characterization suite.
 *
 * The test file declares every vi.mock (they are hoisted) and points each
 * factory at a module object exported here. This file must not import the
 * page or any module the suite mocks, or a mock factory would import it in a
 * cycle.
 */

export const MOVIE = { id: "m1", title: "Night Diner", runtime_minutes: 120 };
export const SCRIPT = { id: "s1", movie_id: "m1", script_url: "fixture.pdf" };

const scenario = { scenes: [], stills: [], nextSceneNumber: 1 };

// ---------- API ----------

/** Requests the test settles itself: saves, deletes and AI format calls. */
export const pending = { saves: [], deletes: [], formats: [] };

function track(queue, args, value) {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const entry = { args, promise, resolve: (next = value) => resolve(next), reject };
  queue.push(entry);
  return promise;
}

/** A saved scene row built from a request payload, like the API serializer. */
export function sceneRowFromPayload(id, payload) {
  return sceneRow({
    id,
    start_time_seconds: payload.start_time_seconds,
    end_time_seconds: payload.end_time_seconds,
    tags: payload.tags,
    page_start: payload.page_start,
    page_end: payload.page_end,
    selected_text: payload.selected_text,
    raw_selected_text: payload.raw_selected_text,
    formatted_selected_text: payload.formatted_selected_text,
    context_prefix: payload.context_prefix,
    context_suffix: payload.context_suffix,
    start_offset: payload.start_offset,
    end_offset: payload.end_offset,
    anchor_geometry: payload.anchor_geometry,
    updated_at: "2026-09-14T00:00:00.000Z",
  });
}

export const fakeApi = {
  getMovie: vi.fn(),
  getScript: vi.fn(),
  listScriptScenes: vi.fn(),
  createScriptScene: vi.fn(),
  updateScriptScene: vi.fn(),
  deleteScriptScene: vi.fn(),
  formatScreenplaySelection: vi.fn(),
  getViewUrlForKey: vi.fn(),
  listAnnotations: vi.fn(),
};

function installApi() {
  fakeApi.getMovie.mockImplementation(async () => ({ ...MOVIE }));
  fakeApi.getScript.mockImplementation(async () => ({ ...SCRIPT }));
  fakeApi.listScriptScenes.mockImplementation(async () => scenario.scenes);
  fakeApi.createScriptScene.mockImplementation((movieId, scriptId, payload) => {
    const id = `scene-new-${scenario.nextSceneNumber++}`;
    return track(pending.saves, [movieId, scriptId, payload], sceneRowFromPayload(id, payload));
  });
  fakeApi.updateScriptScene.mockImplementation((movieId, scriptId, sceneId, payload) =>
    track(pending.saves, [movieId, scriptId, sceneId, payload], sceneRowFromPayload(sceneId, payload))
  );
  fakeApi.deleteScriptScene.mockImplementation((movieId, scriptId, sceneId) =>
    track(pending.deletes, [movieId, scriptId, sceneId], null)
  );
  fakeApi.formatScreenplaySelection.mockImplementation((payload) => track(pending.formats, [payload], undefined));
  fakeApi.getViewUrlForKey.mockImplementation(async () => ({ url: "" }));
  fakeApi.listAnnotations.mockImplementation(async () => scenario.stills);
}

// ---------- Session ----------

const session = { ready: true, isAdmin: true };

export const sessionModule = {
  useSession: () => session,
};

// ---------- react-pdf ----------

const pdf = { document: null };

function DocumentDouble({ onLoadSuccess, children }) {
  useEffect(() => {
    onLoadSuccess(pdf.document);
  }, [onLoadSuccess]);
  return createElement("div", { "data-testid": "pdf-document" }, children);
}

function PageDouble({ pageNumber }) {
  return createElement("div", { "data-testid": `pdf-canvas-${pageNumber}` });
}

export const reactPdfModule = {
  Document: DocumentDouble,
  Page: PageDouble,
  pdfjs: { GlobalWorkerOptions: {} },
};

/** The object the viewer received as its loaded PDF document. */
export function loadedPdfDocument() {
  return pdf.document;
}

// ---------- Text index ----------

const EMPTY_INDEX = { doc: null, pages: new Map(), complete: false, actionMargin: null, pageOffsets: null };
const indexListeners = new Set();
let currentIndex = EMPTY_INDEX;

function subscribeToIndex(listener) {
  indexListeners.add(listener);
  return () => indexListeners.delete(listener);
}

function readIndex() {
  return currentIndex;
}

export const textIndexModule = {
  useScriptTextIndex: function useScriptTextIndex() {
    return useSyncExternalStore(subscribeToIndex, readIndex);
  },
};

/** Publishes a new text index object, as the background indexer does. */
export function publishIndex(index) {
  act(() => {
    currentIndex = index;
    for (const listener of [...indexListeners]) listener();
  });
  return index;
}

export function publishPages(pages, options) {
  return publishIndex(textIndexFrom(pages, options));
}

// ---------- Windowing ----------

const noopRef = () => {};

export const windowingDouble = {
  scrollToPage: vi.fn((pageNumber, { onDone } = {}) => onDone?.(true)),
  onPageRendered: vi.fn(),
  revealAllPages: vi.fn(),
};

export const windowingModule = {
  usePdfPageWindowing: (numPages) => ({
    wrapRef: noopRef,
    sentinelRef: noopRef,
    compact: false,
    pageWidth: 612,
    pixelRatio: 1,
    renderedPageCount: numPages,
    renderStart: 1,
    renderEnd: numPages,
    pageHeights: {},
    defaultPageHeight: 792,
    onPageRendered: windowingDouble.onPageRendered,
    scrollToPage: windowingDouble.scrollToPage,
    revealAllPages: windowingDouble.revealAllPages,
  }),
};

// ---------- PDF page frame ----------

const frameCommits = new Map();

/** Records the props of every committed render, per page. */
function PdfPageFrameDouble(props) {
  useLayoutEffect(() => {
    if (!frameCommits.has(props.pageNumber)) frameCommits.set(props.pageNumber, []);
    frameCommits.get(props.pageNumber).push(props);
  });
  return createElement("div", { "data-testid": `pdf-page-${props.pageNumber}` });
}

export const pdfPageFrameModule = { PdfPageFrame: PdfPageFrameDouble };

/** The props of the latest committed render of a page frame, or null. */
export function frameProps(pageNumber) {
  const commits = frameCommits.get(pageNumber);
  return commits ? commits[commits.length - 1] : null;
}

export function hoverLine(pageNumber, lineIndex) {
  const props = frameProps(pageNumber);
  const line = props.pageIndex.lines[lineIndex];
  act(() => props.onHoverLine({ pageNumber, line }));
}

export function openLineMenu(pageNumber, lineIndex) {
  const props = frameProps(pageNumber);
  const line = props.pageIndex?.lines[lineIndex] ?? null;
  act(() => props.onLineContextMenu({ pageNumber, line, x: 10, y: 10, indexed: true }));
}

export function clickSceneBar(pageNumber, sceneId) {
  const props = frameProps(pageNumber);
  const segment = props.sceneSegments.find((item) => item.scene.id === sceneId);
  act(() => props.onSelectScene(segment.scene));
}

// ---------- AI page snapshots ----------

export const renderSelectionSnapshots = vi.fn(async () => ({
  pageImages: [{ page: 1, dataUrl: "data:image/jpeg;base64,AA==" }],
  omittedPageCount: 0,
}));

export const pageSnapshotsModule = { renderSelectionSnapshots };

// ---------- window.confirm ----------

const confirmAnswers = [];
let confirmSpy = null;

/** Queues answers for the next window.confirm prompts; unscripted prompts answer false. */
export function answerConfirm(...answers) {
  confirmAnswers.push(...answers);
}

// ---------- Lifecycle and rendering ----------

export function resetHarness() {
  scenario.scenes = [];
  scenario.stills = [];
  scenario.nextSceneNumber = 1;
  for (const queue of Object.values(pending)) queue.length = 0;
  currentIndex = EMPTY_INDEX;
  frameCommits.clear();
  confirmAnswers.length = 0;
  session.ready = true;
  session.isAdmin = true;
  pdf.document = null;
  for (const fn of Object.values(fakeApi)) fn.mockClear();
  for (const fn of Object.values(windowingDouble)) fn.mockClear();
  renderSelectionSnapshots.mockClear();
  installApi();
  confirmSpy?.mockRestore();
  confirmSpy = vi
    .spyOn(window, "confirm")
    .mockImplementation(() => (confirmAnswers.length > 0 ? confirmAnswers.shift() : false));
}

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location" }, `${location.pathname}${location.search}`);
}

/**
 * Renders the viewer route for movie m1 / script s1 and waits until the PDF
 * pages have mounted. Scenes, stills and the session are set before loading.
 */
export async function renderViewer(ScriptViewerRoute, { scenes = [], stills = [], numPages = 3, sceneId = "", admin = true } = {}) {
  scenario.scenes = scenes;
  scenario.stills = stills;
  session.isAdmin = admin;
  pdf.document = { numPages };
  const entry = `/movies/m1/scripts/s1${sceneId ? `?sceneId=${encodeURIComponent(sceneId)}` : ""}`;

  render(
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(LocationProbe),
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/movies/:movieId/scripts/:scriptId", element: createElement(ScriptViewerRoute) }),
        createElement(Route, { path: "*", element: createElement("p", null, "Outside the script viewer") })
      )
    )
  );
  await waitFor(() => expect(frameProps(numPages)).not.toBeNull());
}

export function currentLocation() {
  return screen.getByTestId("location").textContent;
}

/** Lets pending promise callbacks and their state updates run. */
export async function flush() {
  await act(async () => {});
}

export async function settle(entry, value) {
  await act(async () => {
    entry.resolve(value);
  });
}

export async function fail(entry, error) {
  await act(async () => {
    entry.reject(error);
  });
}

// ---------- Queries and gestures ----------

export function annotator() {
  return screen.getByRole("complementary", { name: "Scene annotator" });
}

export function queryAnnotator() {
  return screen.queryByRole("complementary", { name: "Scene annotator" });
}

export function editorDialog() {
  return screen.getByRole("dialog");
}

export function editorBlock(number = 1) {
  return within(editorDialog()).getByRole("textbox", { name: new RegExp(`, block ${number}$`) });
}

export function savedScenesGrid() {
  return screen.getByRole("region", { name: /^Scenes in this script/ });
}

/** A saved scene card, found by its film timing ("00:10:00 – 00:11:00"). */
export function sceneCard(timing) {
  return within(savedScenesGrid()).getByText(timing).closest('[role="button"]');
}

export function menuItem(name) {
  return within(screen.getByRole("menu", { name: "Anchor tools" })).getByRole("menuitem", { name });
}

/** Fires a keydown on the window (or a target); returns false when prevented. */
export function pressKey(key, init = {}, target = window) {
  return fireEvent.keyDown(target, { key, ...init });
}

/** Hovers each line and presses [ then ], as an admin places anchors. */
export function placeAnchorsWithKeys([startPage, startLine], [endPage, endLine]) {
  hoverLine(startPage, startLine);
  pressKey("[");
  hoverLine(endPage, endLine);
  pressKey("]");
}

export function timeInput(label) {
  return within(annotator()).getByRole("textbox", { name: label });
}

export function typeTime(label, value) {
  fireEvent.change(timeInput(label), { target: { value } });
}
