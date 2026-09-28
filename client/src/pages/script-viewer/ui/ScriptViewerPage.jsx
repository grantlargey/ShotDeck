import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Document, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { getStillProjectPath } from "@/entities/annotation/model/still.js";
import { formatFilmTiming } from "@/entities/script-scene/model/filmTiming.js";
import {
  findOverlappingScriptLocation,
  formatScenePages,
  sceneScrollTarget,
  projectScriptLocation,
} from "@/entities/script-scene/model/scriptLocation.js";
import { useSession } from "@/entities/session/model/useSession.js";
import { getMovie } from "@/shared/api/movies.js";
import { formatScreenplaySelection } from "@/shared/api/screenplayFormat.js";
import { getScript } from "@/shared/api/scripts.js";
import { cx } from "@/shared/lib/cx.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { isTypingTarget } from "@/shared/lib/keyboard.js";
import { Button } from "@/shared/ui/Button.jsx";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { CloseIcon } from "@/shared/ui/icons.jsx";
import { LoadingState } from "@/shared/ui/LoadingState.jsx";
import { SceneViewerModal } from "@/widgets/scene-detail-modal/ui/SceneViewerModal.jsx";
import { renderSelectionSnapshots } from "../lib/pageSnapshots.js";
import { buildSceneSegmentsByPage } from "../model/anchors.js";
import { useSceneCollection } from "../model/sceneCollection.js";
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

// Asked before saving stale text with the current anchors' location.
const STALE_SAVE_PROMPT =
  "This scene text doesn't match the current anchors. Save it anyway? The scene keeps this text, but its script location will come from the current anchors. To save the text between the anchors instead, cancel and re-capture.";

// Reported when a link to a captured scene can never be followed: indexing has
// finished and the page its script location sits on holds no readable text, so
// the viewer has nothing to scroll to. Stated without the page number, which
// stays on the admin's anchor surfaces.
const UNREACHABLE_SCENE_NOTICE = "Couldn't show this scene in the script: its page has no readable text.";

function parsePageParam(value) {
  const page = Number(value);
  return value !== null && Number.isInteger(page) && page > 0 ? page : null;
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

  const [loadedMovie, setLoadedMovie] = useState(null);
  const [loadedScript, setLoadedScript] = useState(null);
  // The captured scenes are part of the page's load, so their failure fails it.
  const [sceneLoadFailed, setSceneLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pdfLoadError, setPdfLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("capture");
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
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
  const textIndex = useScriptTextIndex(pdfDocument);
  const windowing = usePdfPageWindowing(pdfDocument, textIndex.pages);
  // Callback refs, taken once: JSX may not read a ref off an object during render.
  const { wrapRef, sentinelRef } = windowing;
  // The captured scenes load in their own request, but they are still part of
  // loading the page: a failure reports the same notice and leaves the page
  // without a project or a script, so the viewer never shows a script whose
  // scenes are missing. This stands for the life of the page, which is safe
  // because ScriptViewerRoute keys it by scriptId.
  const reportSceneLoadError = useCallback((error) => {
    setSceneLoadFailed(true);
    setNotice({ tone: "error", text: getErrorMessage(error, "Failed to load the script viewer.") });
  }, []);
  // The script's captured scenes, their order and their requests live in useSceneCollection.
  const scenes = useSceneCollection({ movieId, scriptId, onLoadError: reportSceneLoadError });
  // What the draft's text and script location are, and what saving stores, lives in useSceneDraft.
  const [draft, draftActions] = useSceneDraft(textIndex);
  const draftSceneId = draft.savedScene?.id ?? "";
  // The one scene the page is about right now: the admin's scene draft, or the
  // scene a visitor last opened or followed a link to. The page frames and the
  // scene grid both mark it, and a deep link's pending scroll is only honoured
  // while it is still this scene.
  const activeSceneId = canEdit ? draftSceneId : focusSceneId;

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMovie(movieId), getScript(movieId, scriptId)])
      .then(([movieData, scriptData]) => {
        if (cancelled) return;
        setLoadedMovie(movieData);
        setLoadedScript(scriptData);
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

  // Any part of the load failing leaves the whole page unloaded, whichever
  // request it was: the title falls back, no PDF is offered, and no scenes are
  // listed. A response that arrives after another request failed doesn't undo it.
  const movie = sceneLoadFailed ? null : loadedMovie;
  const script = sceneLoadFailed ? null : loadedScript;

  // ---------- Page views of the draft ----------

  const sceneSegmentsByPage = useMemo(() => buildSceneSegmentsByPage(scenes.list, textIndex.pages), [scenes.list, textIndex.pages]);
  const draftProjectionsByPage = useMemo(() => new Map(
    [...textIndex.pages].map(([number, page]) => [number, projectScriptLocation(draft.anchors, page)])
  ), [draft.anchors, textIndex.pages]);
  const overlapScene = useMemo(
    () => findOverlappingScriptLocation(scenes.list, draft.anchors, draftSceneId),
    [scenes.list, draft.anchors, draftSceneId]
  );
  const title = movie?.title || "Script";
  const runtimeSeconds = movie?.runtime_minutes ? Number(movie.runtime_minutes) * 60 : 0;
  useDocumentTitle(movie ? `${movie.title} script` : "Script");

  // ---------- Navigation and scrolling ----------

  /*
   * A deep link's scroll is an intent that outlives the render that made it: it
   * waits for the background indexer to publish the page its script location
   * sits on, which can be many seconds after the link opened. Three things can
   * end that wait — the scroll runs, something supersedes it, or its page turns
   * out never to be coming — and until one of them does, the intent stays armed
   * and will fire into whatever the viewer has become by then.
   *
   * dropPendingScroll ends the wait silently, for every case where the person
   * did the superseding themselves and needs no telling.
   */
  const dropPendingScroll = useStableHandler(() => setPendingScroll(null));

  // Giving up because the page is never coming does have to be said out loud:
  // the link promised to land on a scene, and without a word the script would
  // just sit where it is with nothing to explain it.
  const abandonUnreachableScene = useStableHandler(() => {
    setPendingScroll(null);
    setNotice({ tone: "info", text: UNREACHABLE_SCENE_NOTICE });
  });

  // Scrolling where the admin or the visitor asked supersedes a link that is
  // still waiting: they have taken the viewer over, and the link's scroll would
  // only drag them off what they went to look at. Windowing cancels a scroll
  // already under way on the first wheel, key or pointer; this ends one that has
  // not begun. runPendingScroll asks windowing directly rather than coming
  // through here, so the intent's own scroll is not caught by its own rule.
  function scrollToPoint(pageNumber, offsetPt, options = {}) {
    dropPendingScroll();
    windowing.scrollToPage(pageNumber, { behavior: "smooth", ...options, offsetPt });
  }

  // A linked scene is loaded for editing (admins) or scrolled to and marked (visitors).
  /* eslint-disable react-hooks/set-state-in-effect -- a deep link is applied once, when its scene arrives with the loaded scenes */
  useEffect(() => {
    if (!sessionReady || !sceneIdFromQuery || deepLinkedSceneRef.current === sceneIdFromQuery) return;
    const target = scenes.list.find((scene) => scene.id === sceneIdFromQuery);
    if (!target) return;
    deepLinkedSceneRef.current = sceneIdFromQuery;
    if (canEdit) draftActions.loadScene(target);
    else setFocusSceneId(target.id);
    const scroll = sceneScrollTarget(target, textIndex.pages);
    // The scene the intent belongs to travels with it; see pendingScrollSuperseded.
    if (scroll) setPendingScroll({ ...scroll, location: target.script_location, sceneId: target.id });
  }, [sessionReady, canEdit, sceneIdFromQuery, scenes.list, draftActions, textIndex.pages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const runPendingScroll = useStableHandler((target) => {
    const point = target.location ? sceneScrollTarget({ script_location: target.location }, textIndex.pages) : target;
    windowing.scrollToPage(point.page, {
      behavior: "auto",
      offsetPt: point.offsetPt,
      onDone: () => setPendingScroll(null),
    });
  });

  const pendingScrollReady = numPages > 0 && Boolean(pendingScroll) &&
    (!pendingScroll.location || textIndex.pages.has(pendingScroll.page));
  // The scene the intent was made for is no longer the scene in hand: the admin
  // started a new scene draft or opened another captured scene, or a visitor
  // opened or revealed one. Hanging the intent off activeSceneId rather than off
  // each of those handlers is what stops a handler forgetting to cancel, which
  // is how "New scene" came to leave a link armed — it changes the draft without
  // scrolling, so no scroll of its own would have covered it.
  const pendingScrollSuperseded = Boolean(pendingScroll?.sceneId) && pendingScroll.sceneId !== activeSceneId;
  // Some pages are never indexed: a scan carries no extractable text, and a
  // location can name a page past the end of this document. Once indexing is
  // complete no later publish will add one, so waiting on a page that is still
  // missing is waiting for good.
  const pendingScrollUnreachable = Boolean(pendingScroll?.location) && textIndex.complete &&
    !textIndex.pages.has(pendingScroll.page);
  useEffect(() => {
    // Superseded is read first: someone who has already moved on doesn't need to
    // be told that the link they left behind couldn't be followed either.
    if (pendingScrollSuperseded) dropPendingScroll();
    else if (pendingScrollUnreachable) abandonUnreachableScene();
    else if (pendingScrollReady) runPendingScroll(pendingScroll);
  }, [
    pendingScroll,
    pendingScrollReady,
    pendingScrollSuperseded,
    pendingScrollUnreachable,
    runPendingScroll,
    dropPendingScroll,
    abandonUnreachableScene,
  ]);

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
    const target = scroll && sceneScrollTarget(scene, textIndex.pages);
    if (target) scrollToPoint(target.page, target.offsetPt);
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
    const target = sceneScrollTarget(scene, textIndex.pages);
    if (target) scrollToPoint(target.page, target.offsetPt);
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
    // The scene list sits below the script, so this leaves the pages entirely; a
    // link still waiting for its page would scroll them back out from under it.
    dropPendingScroll();
    windowing.revealAllPages();
    window.requestAnimationFrame(() =>
      scenesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }

  // ---------- Anchors ----------

  function jumpToAnchor(kind) {
    const anchor = draft.anchors[kind];
    if (anchor) {
      const marker = projectScriptLocation({ start: anchor }, textIndex.pages.get(anchor.page)).start;
      if (marker) scrollToPoint(anchor.page, marker.top);
    }
  }

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeModal = useCallback(() => setModal(null), []);
  const handleHoverLine = useCallback((hover) => {
    hoverRef.current = hover;
  }, []);
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
    if (!canEdit || modal || menu || isTypingTarget(event.target, { withinDialog: true })) return;
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
          ? await renderSelectionSnapshots(pdfDocument, request.snapshotAnchors, textIndex.pages)
          : { pageImages: [], omittedPageCount: 0 };
      const { capturedText, draftMarkdown, pageStart, pageEnd } = request;
      const result = await formatScreenplaySelection({
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
    const { error, payload, applySaved, confirmStaleText } = draftActions.buildSave({
      runtimeSeconds,
      scenes: scenes.list,
    });
    if (error) {
      setNotice({ tone: "error", text: error });
      return;
    }
    setNotice(null);
    // The prompt blocks, so the answer covers exactly this payload; the next save asks again.
    if (confirmStaleText && !window.confirm(STALE_SAVE_PROMPT)) return;

    const wasEditing = Boolean(draftSceneId);
    const saved = await scenes.save({ sceneId: draftSceneId, payload: { ...payload, script_key: script.s3_key }, applySaved });
    setNotice(
      saved.ok
        ? { tone: "info", text: wasEditing ? "Scene updated." : "Scene saved." }
        : { tone: "error", text: getErrorMessage(saved.error, "Failed to save the scene.") }
    );
  }

  async function deleteScene(scene) {
    if (!scene || !window.confirm(`Delete the scene at ${formatFilmTiming(scene)}? This can't be undone.`)) return;

    const removed = await scenes.remove({ sceneId: scene.id, prepareDelete: draftActions.prepareDelete });
    if (!removed.ok) {
      setNotice({ tone: "error", text: getErrorMessage(removed.error, "Failed to delete the scene.") });
      return;
    }
    // Deleting from the scene viewer closes it, whichever scene it had stepped to.
    setModal((current) => (current?.kind === "scene" ? null : current));
    setNotice({ tone: "info", text: "Scene deleted." });
  }

  // ---------- Render ----------

  if (loading || scenes.loading) {
    return (
      <div className={styles.page}>
        <LoadingState>Loading script viewer…</LoadingState>
      </div>
    );
  }


  return (
    <div className={styles.page}>
      <ViewerTopBar
        title={title}
        pageCount={numPages}
        sceneCount={scenes.list.length}
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
            <div ref={wrapRef} className={styles.pagesWrap}>
              <Document
                file={script.script_url}
                loading={<p className={styles.viewerMessage}>Loading PDF…</p>}
                onLoadSuccess={setPdfDocument}
                onLoadError={(error) => setPdfLoadError(getErrorMessage(error, "Unable to load this PDF."))}
              >
                {windowing.pages.map((page) => {
                  const { pageNumber } = page;
                  return (
                    <PdfPageFrame
                      key={pageNumber}
                      {...page}
                      readOnly={!canEdit}
                      projection={draftProjectionsByPage.get(pageNumber)}
                      showAnchorMarkers={showAnchorMarkers}
                      sceneSegments={sceneSegmentsByPage.get(pageNumber) || NO_SEGMENTS}
                      activeSceneId={activeSceneId}
                      onLineContextMenu={openLineMenu}
                      onHoverLine={handleHoverLine}
                      onRemoveAnchor={draftActions.removeAnchor}
                      onSelectScene={handleSelectSceneFromPage}
                    />
                  );
                })}
              </Document>
              {windowing.hasMore && (
                <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
              )}
            </div>
          )}
        </section>

        {canEdit && (
          <AnnotatorPanel
            draft={draft}
            draftActions={draftActions}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            movieTitle={title}
            runtimeSeconds={runtimeSeconds}
            indexStatus={{ complete: textIndex.complete, loaded: textIndex.pages.size, total: numPages }}
            overlapScene={overlapScene}
            onEditOverlapScene={() => overlapScene && selectScene(overlapScene)}
            onNewScene={startNewScene}
            onJumpToAnchor={jumpToAnchor}
            onRecapture={recapture}
            onExpandDraft={() => setModal({ kind: "draft" })}
            onRequestAi={requestAiFormat}
            onReviewProposal={() => setModal({ kind: "draft" })}
            saving={scenes.saving}
            deleting={Boolean(draftSceneId) && scenes.deletingSceneId === draftSceneId}
            onSave={saveScene}
            onDelete={() => deleteScene(draft.savedScene)}
          />
        )}
      </div>

      <SavedScenesGrid
        ref={scenesSectionRef}
        scenes={scenes.list}
        selectedSceneId={activeSceneId}
        title={title}
        readOnly={!canEdit}
        onSelect={(scene) => selectScene(scene)}
        onExpand={(scene) => (canEdit ? setModal({ kind: "scene", sceneId: scene.id }) : showScene(scene))}
      />

      {menu && canEdit && (
        <AnchorContextMenu
          menu={menu}
          anchors={draft.anchors}
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
          meta={[draftSceneId ? "Editing saved scene" : "New scene draft", formatScenePages(draft.previewScene)]
            .filter(Boolean)
            .join(" · ")}
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
          initial={{ sceneId: modal.sceneId }}
          source={{ film: { id: movieId, title, scriptId, scriptScenes: scenes.list } }}
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
              <Button
                variant="danger"
                disabled={scenes.deletingSceneId === scene.id}
                onClick={() => deleteScene(scene)}
              >
                {scenes.deletingSceneId === scene.id ? "Deleting…" : "Delete"}
              </Button>
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
