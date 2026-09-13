import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Document, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { getStillProjectPath } from "@/entities/annotation";
import {
  formatScriptScenePages,
  getScriptScenePageRange,
  sortScriptScenes,
} from "@/entities/script-scene";
import { scriptSceneActions } from "@/features/script-scene-actions";
import { api } from "@/shared/api";
import { useDocumentTitle } from "@/shared/lib/document-title";
import { getErrorMessage } from "@/shared/lib/errors";
import { screenplayToPlainText } from "@/shared/lib/screenplay";
import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time";
import { CloseIcon, IconButton, LoadingState } from "@/shared/ui";
import { SceneModalButton, SceneViewerModal } from "@/widgets/scene-detail-modal";
import { renderSelectionSnapshots } from "../lib/pageSnapshots.js";
import { isTypingTarget } from "../lib/pdfViewport.js";
import {
  anchorsFromGeometry,
  buildSceneSegmentsByPage,
  createLineAnchor,
  findOverlappingSavedScene,
  hasAnyAnchor,
  suggestAnchorsFromSavedText,
} from "../model/anchors.js";
import { captureAnchoredRange } from "../model/captureRange.js";
import { buildScenePayload, createEmptyDraft, draftReducer, isDraftDirty } from "../model/sceneDraft.js";
import { usePdfPageWindowing } from "../model/usePdfPageWindowing.js";
import { useScriptTextIndex } from "../model/useScriptTextIndex.js";
import { AnchorContextMenu } from "./AnchorContextMenu.jsx";
import { AnnotatorPanel } from "./AnnotatorPanel.jsx";
import { DraftEditorModal } from "./DraftEditorModal.jsx";
import { PdfPageFrame } from "./PdfPageFrame.jsx";
import { SavedScenesGrid } from "./SavedScenesGrid.jsx";
import { ViewerTopBar } from "./ViewerTopBar.jsx";
import styles from "./ScriptViewerPage.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const NO_SEGMENTS = [];
const MENU_WIDTH = 296;
const MENU_HEIGHT = 360;

function parsePageParam(value) {
  const page = Number(value);
  return value !== null && Number.isInteger(page) && page > 0 ? page : null;
}

function sceneScrollTarget(scene) {
  const anchors = anchorsFromGeometry(scene?.anchor_geometry);
  if (anchors) return { page: anchors.start.page, offsetPt: anchors.start.top };
  return { page: getScriptScenePageRange(scene).pageStart, offsetPt: null };
}

function formatTiming(scene) {
  return `${formatSecondsToHms(scene.start_time_seconds)} – ${formatSecondsToHms(scene.end_time_seconds)}`;
}

/**
 * Keeps a handler's identity stable while always calling its latest version,
 * so memoized PDF pages don't re-render when unrelated state changes.
 */
function useStableHandler(handler) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args) => handlerRef.current(...args), []);
}

export default function ScriptViewerRoute() {
  const { scriptId } = useParams();
  // Keyed so switching scripts starts from a clean draft and viewer state.
  return <ScriptViewerPage key={scriptId} />;
}

function ScriptViewerPage() {
  const nav = useNavigate();
  const { movieId, scriptId } = useParams();
  const [searchParams] = useSearchParams();
  const sceneIdFromQuery = searchParams.get("sceneId") || searchParams.get("annotationId") || "";

  const [movie, setMovie] = useState(null);
  const [script, setScript] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pdfLoadError, setPdfLoadError] = useState("");
  const [draft, dispatch] = useReducer(draftReducer, undefined, createEmptyDraft);
  const [activeTab, setActiveTab] = useState("capture");
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingSceneId, setDeletingSceneId] = useState("");
  // Hides the on-page start/end markers for uncluttered reading; anchors stay set.
  const [showAnchorMarkers, setShowAnchorMarkers] = useState(true);
  const [pendingScroll, setPendingScroll] = useState(() => {
    const page = parsePageParam(searchParams.get("page"));
    return page ? { page, offsetPt: null } : null;
  });

  const hoverRef = useRef(null);
  const scenesSectionRef = useRef(null);
  const aiRequestRef = useRef(0);
  const deepLinkedSceneRef = useRef("");

  const numPages = pdfDocument?.numPages ?? 0;
  const windowing = usePdfPageWindowing(numPages);
  const textIndex = useScriptTextIndex(pdfDocument);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getMovie(movieId), api.getScript(movieId, scriptId), api.listScriptScenes(movieId, scriptId)])
      .then(([movieData, scriptData, sceneData]) => {
        if (cancelled) return;
        setMovie(movieData);
        setScript(scriptData);
        setScenes(sortScriptScenes(Array.isArray(sceneData) ? sceneData : []));
      })
      .catch((error) => {
        if (!cancelled) setNotice({ tone: "error", text: getErrorMessage(error, "Failed to load the script viewer.") });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movieId, scriptId]);

  // ---------- Derived draft state ----------

  const suggestedAnchors = useMemo(() => {
    if (!draft.baseline || draft.suggestionsDismissed || hasAnyAnchor(draft.anchors)) return null;
    return suggestAnchorsFromSavedText(draft.baseline, textIndex.pages);
  }, [draft.baseline, draft.suggestionsDismissed, draft.anchors, textIndex.pages]);

  const anchors = suggestedAnchors || draft.anchors;
  const capture = useMemo(() => captureAnchoredRange(textIndex, anchors), [textIndex, anchors]);
  const markdown = draft.textOrigin === "capture" ? capture?.markdown ?? "" : draft.markdown;
  const captureStale = Boolean(capture) && draft.textOrigin !== "capture" && capture.key !== draft.textAnchorKey;
  const editorSeed = draft.textOrigin === "capture" ? capture?.key ?? "" : draft.textAnchorKey;
  const sceneSegmentsByPage = useMemo(() => buildSceneSegmentsByPage(scenes), [scenes]);
  const overlapScene = useMemo(
    () => findOverlappingSavedScene(scenes, anchors, draft.sceneId),
    [scenes, anchors, draft.sceneId]
  );
  const tagsDisabled = !markdown.trim();
  const visibleTab = tagsDisabled ? "capture" : activeTab;
  const dirty = isDraftDirty(draft, markdown);
  const title = movie?.title || "Script";
  const runtimeSeconds = movie?.runtime_minutes ? Number(movie.runtime_minutes) * 60 : 0;
  useDocumentTitle(movie ? `${movie.title} script` : "Script");

  const draftScene = useMemo(
    () => ({
      id: draft.sceneId || "draft",
      start_time_seconds: parseTimeInputToSeconds(draft.startTime),
      end_time_seconds: parseTimeInputToSeconds(draft.endTime),
      page_start: capture?.pageStart ?? draft.baseline?.page_start ?? null,
      page_end: capture?.pageEnd ?? draft.baseline?.page_end ?? null,
      tags: draft.tags,
      formatted_selected_text: markdown,
      first_image_annotation: draft.baseline?.first_image_annotation ?? null,
    }),
    [draft.sceneId, draft.startTime, draft.endTime, draft.baseline, draft.tags, capture, markdown]
  );

  // ---------- Navigation and scrolling ----------

  function pageScale(pageNumber) {
    return windowing.pageWidth / (textIndex.pages.get(pageNumber)?.width || 612);
  }

  function scrollToPoint(pageNumber, offsetPt, options = {}) {
    windowing.scrollToPage(pageNumber, {
      behavior: "smooth",
      ...options,
      offsetPx: offsetPt === null ? null : offsetPt * pageScale(pageNumber),
    });
  }

  useEffect(() => {
    if (!sceneIdFromQuery || deepLinkedSceneRef.current === sceneIdFromQuery) return;
    const target = scenes.find((scene) => scene.id === sceneIdFromQuery);
    if (!target) return;
    deepLinkedSceneRef.current = sceneIdFromQuery;
    dispatch({ type: "loadScene", scene: target });
    setPendingScroll(sceneScrollTarget(target));
  }, [sceneIdFromQuery, scenes]);

  const runPendingScroll = useStableHandler((target) => {
    scrollToPoint(target.page, target.offsetPt, { behavior: "auto", onDone: () => setPendingScroll(null) });
  });

  useEffect(() => {
    if (pendingScroll && numPages > 0) runPendingScroll(pendingScroll);
  }, [pendingScroll, numPages, runPendingScroll]);

  useEffect(() => {
    if (notice?.tone !== "info") return undefined;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function confirmDiscardChanges() {
    return !dirty || window.confirm("Discard unsaved changes to the current scene?");
  }

  function selectScene(scene, { scroll = true } = {}) {
    if (draft.sceneId !== scene.id) {
      if (!confirmDiscardChanges()) return;
      dispatch({ type: "loadScene", scene });
      setActiveTab("capture");
    }
    if (scroll) {
      const target = sceneScrollTarget(scene);
      scrollToPoint(target.page, target.offsetPt);
    }
  }

  function startNewScene() {
    if (!confirmDiscardChanges()) return;
    dispatch({ type: "reset" });
    setActiveTab("capture");
  }

  function openStillInProject(still) {
    if (!still?.id || !confirmDiscardChanges()) return;
    nav(getStillProjectPath(movieId, still.id));
  }

  function showScenesWithTag(tag) {
    if (!confirmDiscardChanges()) return;
    nav(`/script-search?tag=${encodeURIComponent(tag)}`);
  }

  function jumpToScenes() {
    if (windowing.compact) windowing.revealAllPages();
    window.requestAnimationFrame(() =>
      scenesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }

  // ---------- Anchors ----------

  function setAnchorAtLine(kind, pageNumber, line) {
    const page = textIndex.pages.get(pageNumber);
    if (!page || !line) return;
    dispatch({ type: "setAnchor", kind, anchor: createLineAnchor(page, line), currentAnchors: anchors });
  }

  function jumpToAnchor(kind) {
    const anchor = anchors[kind];
    if (anchor) scrollToPoint(anchor.page, anchor.top);
  }

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeModal = useCallback(() => setModal(null), []);
  const handleHoverLine = useCallback((hover) => {
    hoverRef.current = hover;
  }, []);
  const handlePageRendered = useStableHandler((pageNumber) => windowing.onPageRendered(pageNumber));
  const handleRemoveAnchor = useStableHandler((kind) =>
    dispatch({ type: "removeAnchor", kind, currentAnchors: anchors })
  );
  const handleSelectSceneFromPage = useStableHandler((scene) => selectScene(scene, { scroll: false }));

  const openLineMenu = useStableHandler(({ pageNumber, line, x, y, indexed }) => {
    const scenesAtLine = line
      ? (sceneSegmentsByPage.get(pageNumber) || [])
          .filter(
            (segment) =>
              (segment.top === null || segment.top <= line.bottom) &&
              (segment.bottom === null || segment.bottom >= line.top)
          )
          .map((segment) => segment.scene)
      : [];
    setMenu({
      pageNumber,
      line,
      indexed,
      scenes: scenesAtLine,
      x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH)),
      y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT)),
    });
  });

  const handleKeyDown = useStableHandler((event) => {
    if (modal || menu || isTypingTarget(event.target)) return;
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
      if (draft.anchorHistory.length === 0) return;
      event.preventDefault();
      dispatch({ type: "undoAnchors" });
      return;
    }

    if (modifier || event.altKey || (event.key !== "[" && event.key !== "]")) return;
    const hover = hoverRef.current;
    if (!hover) return;
    event.preventDefault();
    setAnchorAtLine(event.key === "[" ? "start" : "end", hover.pageNumber, hover.line);
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ---------- Draft text ----------

  function normalizeTime(field) {
    const seconds = parseTimeInputToSeconds(draft[field]);
    if (seconds !== null) {
      dispatch({ type: "setTime", field, value: formatSecondsToHms(seconds, { fallback: "00:00:00" }) });
    }
  }

  function recapture() {
    if (!capture) return;
    const replacesEdits = draft.textOrigin === "edited" || draft.textOrigin === "ai";
    if (
      replacesEdits &&
      !window.confirm("Replace the current text with a fresh capture from the anchors? Your text edits will be lost.")
    ) {
      return;
    }
    dispatch({ type: "applyCapture", anchors, capture });
  }

  function editMarkdown(nextMarkdown) {
    dispatch({
      type: "editMarkdown",
      markdown: nextMarkdown,
      anchorKey: draft.textOrigin === "capture" ? capture?.key : undefined,
    });
  }

  async function requestAiFormat() {
    const capturedText = capture?.plainText || screenplayToPlainText(markdown);
    if (!capturedText.trim()) return;

    aiRequestRef.current += 1;
    const requestId = aiRequestRef.current;
    dispatch({ type: "proposalStart", requestId });

    try {
      const snapshots =
        capture && pdfDocument
          ? await renderSelectionSnapshots(pdfDocument, anchors)
          : { pageImages: [], omittedPageCount: 0 };
      const result = await api.formatScreenplaySelection({
        capturedText,
        draftMarkdown: markdown,
        pageStart: capture?.pageStart ?? draft.baseline?.page_start ?? null,
        pageEnd: capture?.pageEnd ?? draft.baseline?.page_end ?? null,
        ...snapshots,
      });
      dispatch({ type: "proposalReady", requestId, markdown: result?.markdown || "" });
    } catch (error) {
      dispatch({ type: "proposalError", requestId, error: getErrorMessage(error, "AI formatting failed.") });
    }
  }

  // ---------- Persistence ----------

  async function saveScene() {
    const { error, payload } = buildScenePayload({ draft, capture, markdown, runtimeSeconds });
    if (error) {
      setNotice({ tone: "error", text: error });
      return;
    }

    const wasEditing = Boolean(draft.sceneId);
    setSaving(true);
    setNotice(null);
    try {
      const saved = wasEditing
        ? await scriptSceneActions.update(movieId, scriptId, draft.sceneId, payload)
        : await scriptSceneActions.create(movieId, scriptId, payload);
      setScenes((prev) => sortScriptScenes([...prev.filter((scene) => scene.id !== saved.id), saved]));
      dispatch({ type: "loadScene", scene: saved });
      setNotice({ tone: "info", text: wasEditing ? "Scene updated." : "Scene saved." });
    } catch (saveError) {
      setNotice({ tone: "error", text: getErrorMessage(saveError, "Failed to save the scene.") });
    } finally {
      setSaving(false);
    }
  }

  async function deleteScene(scene) {
    if (!scene || !window.confirm(`Delete the scene at ${formatTiming(scene)}? This can't be undone.`)) return;

    setDeletingSceneId(scene.id);
    try {
      await scriptSceneActions.delete(movieId, scriptId, scene.id);
      setScenes((prev) => prev.filter((row) => row.id !== scene.id));
      if (draft.sceneId === scene.id) dispatch({ type: "reset" });
      // Deleting from the scene viewer closes it, whichever scene it had stepped to.
      setModal((current) => (current?.kind === "scene" ? null : current));
      setNotice({ tone: "info", text: "Scene deleted." });
    } catch (deleteError) {
      setNotice({ tone: "error", text: getErrorMessage(deleteError, "Failed to delete the scene.") });
    } finally {
      setDeletingSceneId("");
    }
  }

  // ---------- Render ----------

  if (loading) {
    return (
      <div className={styles.page}>
        <LoadingState>Loading script viewer…</LoadingState>
      </div>
    );
  }

  const pageNumbers = Array.from({ length: windowing.renderedPageCount }, (_, index) => index + 1);

  return (
    <div className={styles.page}>
      <ViewerTopBar
        title={title}
        pageCount={numPages}
        sceneCount={scenes.length}
        anchorMarkersVisible={showAnchorMarkers}
        onToggleAnchorMarkers={() => setShowAnchorMarkers((visible) => !visible)}
        onBackToMovie={() => nav(`/movies/${movieId}`)}
        onSearchScripts={() => nav("/script-search")}
        onJumpToScenes={jumpToScenes}
      />

      <div className={styles.workspace}>
        <section className={styles.viewer} aria-label="Script PDF">
          {!script?.script_url ? (
            <p className={styles.viewerMessage}>This script has no PDF file.</p>
          ) : pdfLoadError ? (
            <p className={styles.viewerMessage}>{pdfLoadError}</p>
          ) : (
            <div ref={windowing.wrapRef} className={styles.pagesWrap}>
              <Document
                file={script.script_url}
                loading={<p className={styles.viewerMessage}>Loading PDF…</p>}
                onLoadSuccess={setPdfDocument}
                onLoadError={(error) => setPdfLoadError(getErrorMessage(error, "Unable to load this PDF."))}
              >
                {pageNumbers.map((pageNumber) => {
                  const inWindow =
                    !windowing.compact ||
                    (pageNumber >= windowing.renderStart && pageNumber <= windowing.renderEnd);
                  const inRange =
                    Boolean(anchors.start && anchors.end) &&
                    pageNumber >= anchors.start.page &&
                    pageNumber <= anchors.end.page;

                  return (
                    <PdfPageFrame
                      key={pageNumber}
                      pageNumber={pageNumber}
                      pageIndex={textIndex.pages.get(pageNumber) || null}
                      pageWidth={windowing.pageWidth}
                      inWindow={inWindow}
                      placeholderHeight={
                        inWindow ? 0 : windowing.pageHeights[pageNumber] || windowing.defaultPageHeight
                      }
                      compact={windowing.compact}
                      devicePixelRatio={windowing.pixelRatio}
                      startAnchor={showAnchorMarkers && anchors.start?.page === pageNumber ? anchors.start : null}
                      endAnchor={showAnchorMarkers && anchors.end?.page === pageNumber ? anchors.end : null}
                      rangeTop={inRange ? (pageNumber === anchors.start.page ? anchors.start.top : 0) : null}
                      rangeBottom={
                        inRange ? (pageNumber === anchors.end.page ? anchors.end.bottom : Infinity) : null
                      }
                      sceneSegments={sceneSegmentsByPage.get(pageNumber) || NO_SEGMENTS}
                      activeSceneId={draft.sceneId}
                      onLineContextMenu={openLineMenu}
                      onHoverLine={handleHoverLine}
                      onRemoveAnchor={handleRemoveAnchor}
                      onSelectScene={handleSelectSceneFromPage}
                      onRendered={handlePageRendered}
                    />
                  );
                })}
              </Document>
              {windowing.compact && windowing.renderedPageCount < numPages && (
                <div ref={windowing.sentinelRef} className={styles.sentinel} aria-hidden="true" />
              )}
            </div>
          )}
        </section>

        <AnnotatorPanel
          editing={Boolean(draft.sceneId)}
          sceneLabel={draft.baseline ? formatTiming(draft.baseline) : "Untitled scene"}
          onNewScene={startNewScene}
          activeTab={visibleTab}
          onTabChange={setActiveTab}
          tagsDisabled={tagsDisabled}
          anchors={anchors}
          anchorsSuggested={Boolean(suggestedAnchors)}
          canUndo={draft.anchorHistory.length > 0}
          indexStatus={{ complete: textIndex.complete, loaded: textIndex.pages.size, total: numPages }}
          onJumpToAnchor={jumpToAnchor}
          onRemoveAnchor={handleRemoveAnchor}
          onClearAnchors={() => dispatch({ type: "clearAnchors" })}
          onUndoAnchors={() => dispatch({ type: "undoAnchors" })}
          overlapScene={overlapScene}
          onEditOverlapScene={() => overlapScene && selectScene(overlapScene)}
          startTime={draft.startTime}
          endTime={draft.endTime}
          runtimeSeconds={runtimeSeconds}
          onTimeChange={(field, value) => dispatch({ type: "setTime", field, value })}
          onTimeBlur={normalizeTime}
          capture={capture}
          markdown={markdown}
          textOrigin={draft.textOrigin}
          captureStale={captureStale}
          legacyText={draft.textOrigin === "saved" && !draft.textAnchorKey}
          draftScene={draftScene}
          movieTitle={title}
          proposal={draft.proposal}
          onRecapture={recapture}
          onExpandDraft={() => setModal({ kind: "draft" })}
          onRequestAi={requestAiFormat}
          onReviewProposal={() => setModal({ kind: "draft" })}
          onDiscardProposal={() => dispatch({ type: "proposalDiscard" })}
          tags={draft.tags}
          onToggleTag={(tag) => dispatch({ type: "toggleTag", tag })}
          onClearTags={() => dispatch({ type: "clearTags" })}
          saving={saving}
          deleting={Boolean(draft.sceneId) && deletingSceneId === draft.sceneId}
          onSave={saveScene}
          onDelete={() => deleteScene(draft.baseline)}
        />
      </div>

      <SavedScenesGrid
        ref={scenesSectionRef}
        scenes={scenes}
        selectedSceneId={draft.sceneId}
        title={title}
        onSelect={(scene) => selectScene(scene)}
        onExpand={(scene) => setModal({ kind: "scene", sceneId: scene.id })}
      />

      {menu && (
        <AnchorContextMenu
          menu={menu}
          anchors={anchors}
          canUndo={draft.anchorHistory.length > 0}
          onSetAnchor={setAnchorAtLine}
          onRemoveAnchor={handleRemoveAnchor}
          onClearAnchors={() => dispatch({ type: "clearAnchors" })}
          onUndo={() => dispatch({ type: "undoAnchors" })}
          onSelectScene={(scene) => selectScene(scene, { scroll: false })}
          onClose={closeMenu}
        />
      )}

      {modal?.kind === "draft" && (
        <DraftEditorModal
          title={title}
          meta={`${draft.sceneId ? "Editing saved scene" : "New scene draft"} · ${formatScriptScenePages(draftScene)}`}
          editorKey={`${draft.editorRevision}:${editorSeed}`}
          markdown={markdown}
          onChangeMarkdown={editMarkdown}
          baselineText={capture && !captureStale ? capture.plainText : ""}
          proposal={draft.proposal}
          onRequestAi={requestAiFormat}
          onAcceptProposal={() => dispatch({ type: "proposalAccept", anchorKey: capture?.key })}
          onDiscardProposal={() => dispatch({ type: "proposalDiscard" })}
          recaptureLabel={
            !capture
              ? ""
              : captureStale
                ? "Re-capture from anchors"
                : draft.textOrigin !== "capture"
                  ? "Revert to captured text"
                  : ""
          }
          onRecapture={recapture}
          onClose={closeModal}
        />
      )}

      {modal?.kind === "scene" && (
        <SceneViewerModal
          key={modal.sceneId}
          initialView="script"
          initialSceneId={modal.sceneId}
          scenes={scenes}
          scriptScenes={scenes}
          movie={{ id: movieId, title }}
          scriptId={scriptId}
          onClose={closeModal}
          onSelectTag={showScenesWithTag}
          onOpenStill={openStillInProject}
          onOpenScene={(scene) => {
            setModal(null);
            selectScene(scene);
          }}
          openSceneLabel="Edit scene"
          renderActions={({ view, scene }) =>
            view === "script" &&
            scene && (
              <SceneModalButton
                variant="danger"
                disabled={deletingSceneId === scene.id}
                onClick={() => deleteScene(scene)}
              >
                {deletingSceneId === scene.id ? "Deleting…" : "Delete"}
              </SceneModalButton>
            )
          }
        />
      )}

      {notice && (
        <div
          className={`${styles.toast} ${notice.tone === "error" ? styles.toastError : styles.toastInfo}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <IconButton size="sm" label="Dismiss" onClick={() => setNotice(null)}>
            <CloseIcon size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
