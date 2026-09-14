import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useSession } from "@/entities/session";
import { scriptSceneActions } from "@/features/script-scene-actions";
import { api } from "@/shared/api";
import { cx } from "@/shared/lib/cx";
import { useDocumentTitle } from "@/shared/lib/document-title";
import { getErrorMessage } from "@/shared/lib/errors";
import { formatSecondsToHms } from "@/shared/lib/time";
import { CloseIcon, IconButton, LoadingState } from "@/shared/ui";
import { SceneModalButton, SceneViewerModal } from "@/widgets/scene-detail-modal";
import { renderSelectionSnapshots } from "../lib/pageSnapshots.js";
import { isTypingTarget } from "../lib/pdfViewport.js";
import { anchorsFromGeometry, buildSceneSegmentsByPage, findOverlappingSavedScene } from "../model/anchors.js";
import { useSceneDraft } from "../model/sceneDraft.js";
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

// The editor dialog's re-capture button, by the draft's re-capture option.
const RECAPTURE_LABELS = {
  none: "",
  recapture: "Re-capture from anchors",
  revert: "Revert to captured text",
};

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
  // Visitors read the script and open scenes; only admins capture and edit.
  const { ready: sessionReady, isAdmin: canEdit } = useSession();

  const [movie, setMovie] = useState(null);
  const [script, setScript] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pdfLoadError, setPdfLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("capture");
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingSceneId, setDeletingSceneId] = useState("");
  // The scene a visitor last opened or followed a link to, marked in the margin.
  const [focusSceneId, setFocusSceneId] = useState("");
  // Hides the on-page start/end markers for uncluttered reading; anchors stay set.
  const [showAnchorMarkers, setShowAnchorMarkers] = useState(true);
  const [pendingScroll, setPendingScroll] = useState(() => {
    const page = parsePageParam(searchParams.get("page"));
    return page ? { page, offsetPt: null } : null;
  });

  const hoverRef = useRef(null);
  const scenesSectionRef = useRef(null);
  const deepLinkedSceneRef = useRef("");

  const numPages = pdfDocument?.numPages ?? 0;
  const windowing = usePdfPageWindowing(numPages);
  const textIndex = useScriptTextIndex(pdfDocument);
  // What the draft's text and script location are, and what saving stores, lives in useSceneDraft.
  const [draft, draftActions] = useSceneDraft(textIndex);
  const draftSceneId = draft.savedScene?.id ?? "";

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

  // ---------- Page views of the draft ----------

  const sceneSegmentsByPage = useMemo(() => buildSceneSegmentsByPage(scenes), [scenes]);
  const overlapScene = useMemo(
    () => findOverlappingSavedScene(scenes, draft.anchors, draftSceneId),
    [scenes, draft.anchors, draftSceneId]
  );
  const tagsDisabled = !draft.text.trim();
  const visibleTab = tagsDisabled ? "capture" : activeTab;
  const title = movie?.title || "Script";
  const runtimeSeconds = movie?.runtime_minutes ? Number(movie.runtime_minutes) * 60 : 0;
  useDocumentTitle(movie ? `${movie.title} script` : "Script");

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

  // A linked scene is loaded for editing (admins) or scrolled to and marked (visitors).
  useEffect(() => {
    if (!sessionReady || !sceneIdFromQuery || deepLinkedSceneRef.current === sceneIdFromQuery) return;
    const target = scenes.find((scene) => scene.id === sceneIdFromQuery);
    if (!target) return;
    deepLinkedSceneRef.current = sceneIdFromQuery;
    if (canEdit) draftActions.loadScene(target);
    else setFocusSceneId(target.id);
    setPendingScroll(sceneScrollTarget(target));
  }, [sessionReady, canEdit, sceneIdFromQuery, scenes, draftActions]);

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
    return !draft.dirty || window.confirm("Discard unsaved changes to the current scene?");
  }

  function selectScene(scene, { scroll = true } = {}) {
    if (draftSceneId !== scene.id) {
      if (!confirmDiscardChanges()) return;
      draftActions.loadScene(scene);
      setActiveTab("capture");
    }
    if (scroll) {
      const target = sceneScrollTarget(scene);
      scrollToPoint(target.page, target.offsetPt);
    }
  }

  function startNewScene() {
    if (!confirmDiscardChanges()) return;
    draftActions.reset();
    setActiveTab("capture");
  }

  // Visitors open a scene in the viewer dialog instead of loading it for editing.
  function showScene(scene) {
    setFocusSceneId(scene.id);
    setModal({ kind: "scene", sceneId: scene.id });
  }

  function revealScene(scene) {
    setFocusSceneId(scene.id);
    const target = sceneScrollTarget(scene);
    scrollToPoint(target.page, target.offsetPt);
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

  function jumpToAnchor(kind) {
    const anchor = draft.anchors[kind];
    if (anchor) scrollToPoint(anchor.page, anchor.top);
  }

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeModal = useCallback(() => setModal(null), []);
  const handleHoverLine = useCallback((hover) => {
    hoverRef.current = hover;
  }, []);
  const handlePageRendered = useStableHandler((pageNumber) => windowing.onPageRendered(pageNumber));
  const handleSelectSceneFromPage = useStableHandler((scene) =>
    canEdit ? selectScene(scene, { scroll: false }) : showScene(scene)
  );

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
    if (!canEdit || modal || menu || isTypingTarget(event.target)) return;
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
      if (!draft.canUndoAnchors) return;
      event.preventDefault();
      draftActions.undoAnchors();
      return;
    }

    if (modifier || event.altKey || (event.key !== "[" && event.key !== "]")) return;
    const hover = hoverRef.current;
    if (!hover) return;
    event.preventDefault();
    draftActions.setAnchorAtLine(event.key === "[" ? "start" : "end", hover.pageNumber, hover.line);
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ---------- Draft text ----------

  function recapture() {
    if (
      draft.recaptureReplacesEdits &&
      !window.confirm("Replace the current text with a fresh capture from the anchors? Your text edits will be lost.")
    ) {
      return;
    }
    draftActions.recapture();
  }

  async function requestAiFormat() {
    const request = draftActions.startProposal();
    if (!request) return;

    try {
      const snapshots =
        request.snapshotAnchors && pdfDocument
          ? await renderSelectionSnapshots(pdfDocument, request.snapshotAnchors)
          : { pageImages: [], omittedPageCount: 0 };
      const { capturedText, draftMarkdown, pageStart, pageEnd } = request;
      const result = await api.formatScreenplaySelection({
        capturedText,
        draftMarkdown,
        pageStart,
        pageEnd,
        ...snapshots,
      });
      draftActions.proposalReady(request.token, result?.markdown || "");
    } catch (error) {
      draftActions.proposalFailed(request.token, getErrorMessage(error, "AI formatting failed."));
    }
  }

  // ---------- Persistence ----------

  async function saveScene() {
    const { error, payload, applySaved } = draftActions.buildSave(runtimeSeconds);
    if (error) {
      setNotice({ tone: "error", text: error });
      return;
    }

    const wasEditing = Boolean(draftSceneId);
    setSaving(true);
    setNotice(null);
    try {
      const saved = wasEditing
        ? await scriptSceneActions.update(movieId, scriptId, draftSceneId, payload)
        : await scriptSceneActions.create(movieId, scriptId, payload);
      setScenes((prev) => sortScriptScenes([...prev.filter((scene) => scene.id !== saved.id), saved]));
      applySaved(saved);
      setNotice({ tone: "info", text: wasEditing ? "Scene updated." : "Scene saved." });
    } catch (saveError) {
      setNotice({ tone: "error", text: getErrorMessage(saveError, "Failed to save the scene.") });
    } finally {
      setSaving(false);
    }
  }

  async function deleteScene(scene) {
    if (!scene || !window.confirm(`Delete the scene at ${formatTiming(scene)}? This can't be undone.`)) return;

    const completeDelete = draftActions.prepareDelete(scene.id);
    setDeletingSceneId(scene.id);
    try {
      await scriptSceneActions.delete(movieId, scriptId, scene.id);
      setScenes((prev) => prev.filter((row) => row.id !== scene.id));
      completeDelete();
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
  const { anchors } = draft;

  return (
    <div className={styles.page}>
      <ViewerTopBar
        title={title}
        pageCount={numPages}
        sceneCount={scenes.length}
        canEdit={canEdit}
        anchorMarkersVisible={showAnchorMarkers}
        onToggleAnchorMarkers={() => setShowAnchorMarkers((visible) => !visible)}
        onBackToMovie={() => nav(`/movies/${movieId}`)}
        onSearchScripts={() => nav("/script-search")}
        onJumpToScenes={jumpToScenes}
      />

      <div className={cx(styles.workspace, !canEdit && styles.workspaceReadOnly)}>
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
                      readOnly={!canEdit}
                      devicePixelRatio={windowing.pixelRatio}
                      startAnchor={showAnchorMarkers && anchors.start?.page === pageNumber ? anchors.start : null}
                      endAnchor={showAnchorMarkers && anchors.end?.page === pageNumber ? anchors.end : null}
                      rangeTop={inRange ? (pageNumber === anchors.start.page ? anchors.start.top : 0) : null}
                      rangeBottom={
                        inRange ? (pageNumber === anchors.end.page ? anchors.end.bottom : Infinity) : null
                      }
                      sceneSegments={sceneSegmentsByPage.get(pageNumber) || NO_SEGMENTS}
                      activeSceneId={canEdit ? draftSceneId : focusSceneId}
                      onLineContextMenu={openLineMenu}
                      onHoverLine={handleHoverLine}
                      onRemoveAnchor={draftActions.removeAnchor}
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

        {canEdit && (
          <AnnotatorPanel
            editing={Boolean(draftSceneId)}
            sceneLabel={draft.savedScene ? formatTiming(draft.savedScene) : "Untitled scene"}
            onNewScene={startNewScene}
            activeTab={visibleTab}
            onTabChange={setActiveTab}
            tagsDisabled={tagsDisabled}
            anchors={anchors}
            anchorsSuggested={draft.anchorsSuggested}
            canUndo={draft.canUndoAnchors}
            indexStatus={{ complete: textIndex.complete, loaded: textIndex.pages.size, total: numPages }}
            onJumpToAnchor={jumpToAnchor}
            onRemoveAnchor={draftActions.removeAnchor}
            onClearAnchors={draftActions.clearAnchors}
            onUndoAnchors={draftActions.undoAnchors}
            overlapScene={overlapScene}
            onEditOverlapScene={() => overlapScene && selectScene(overlapScene)}
            startTime={draft.startTime}
            endTime={draft.endTime}
            runtimeSeconds={runtimeSeconds}
            onTimeChange={draftActions.setTime}
            onTimeBlur={draftActions.normalizeTime}
            markdown={draft.text}
            textOrigin={draft.textOrigin}
            captureStale={draft.textStale}
            legacyText={draft.legacyText}
            draftScene={draft.previewScene}
            movieTitle={title}
            proposal={draft.proposal}
            onRecapture={recapture}
            onExpandDraft={() => setModal({ kind: "draft" })}
            onRequestAi={requestAiFormat}
            onReviewProposal={() => setModal({ kind: "draft" })}
            onDiscardProposal={draftActions.discardProposal}
            tags={draft.tags}
            onToggleTag={draftActions.toggleTag}
            onClearTags={draftActions.clearTags}
            saving={saving}
            deleting={Boolean(draftSceneId) && deletingSceneId === draftSceneId}
            onSave={saveScene}
            onDelete={() => deleteScene(draft.savedScene)}
          />
        )}
      </div>

      <SavedScenesGrid
        ref={scenesSectionRef}
        scenes={scenes}
        selectedSceneId={canEdit ? draftSceneId : focusSceneId}
        title={title}
        readOnly={!canEdit}
        onSelect={(scene) => selectScene(scene)}
        onExpand={(scene) => (canEdit ? setModal({ kind: "scene", sceneId: scene.id }) : showScene(scene))}
      />

      {menu && canEdit && (
        <AnchorContextMenu
          menu={menu}
          anchors={anchors}
          canUndo={draft.canUndoAnchors}
          onSetAnchor={draftActions.setAnchorAtLine}
          onRemoveAnchor={draftActions.removeAnchor}
          onClearAnchors={draftActions.clearAnchors}
          onUndo={draftActions.undoAnchors}
          onSelectScene={(scene) => selectScene(scene, { scroll: false })}
          onClose={closeMenu}
        />
      )}

      {modal?.kind === "draft" && (
        <DraftEditorModal
          title={title}
          meta={`${draftSceneId ? "Editing saved scene" : "New scene draft"} · ${formatScriptScenePages(draft.previewScene)}`}
          editorKey={draft.editorKey}
          markdown={draft.text}
          onChangeMarkdown={draftActions.editText}
          baselineText={draft.capturedPlainText}
          proposal={draft.proposal}
          onRequestAi={requestAiFormat}
          onAcceptProposal={draftActions.acceptProposal}
          onDiscardProposal={draftActions.discardProposal}
          recaptureLabel={RECAPTURE_LABELS[draft.recaptureOption]}
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
            if (canEdit) selectScene(scene);
            else revealScene(scene);
          }}
          openSceneLabel={canEdit ? "Edit scene" : "Show in script"}
          renderActions={!canEdit ? undefined : ({ view, scene }) =>
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
