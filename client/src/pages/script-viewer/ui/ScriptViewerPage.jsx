import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import {
  displayScriptSceneText,
  findOverlappingScriptScene,
  groupScriptScenesByPage,
  sortScriptScenes,
} from "@/entities/script-scene";
import { scriptSceneActions } from "@/features/script-scene-actions";
import { api } from "@/shared/api";
import { formatSecondsToHms } from "@/shared/lib/time";
import {
  extractSelectionContext,
  isPageRendered,
  pageFromNode,
  scrollPageInWrap,
  selectionBelongsToRoot,
} from "../lib/pdfDom.js";
import {
  buildScriptScenePayload,
  createSceneFormFromScene,
  EMPTY_SCENE_FORM,
  getSelectedCountText,
  getSelectedTextPreview,
} from "../model/sceneForm.js";
import { SavedScenesList } from "./SavedScenesList.jsx";
import { SceneAnnotationForm } from "./SceneAnnotationForm.jsx";
import { ScriptViewerTopBar } from "./ScriptViewerTopBar.jsx";
import styles from "./ScriptViewerPage.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const MOBILE_PDF_BATCH_SIZE = 4;
const MOBILE_PDF_BREAKPOINT = 900;
const MOBILE_PDF_ROOT_MARGIN = "900px 0px";
const MOBILE_DEVICE_PIXEL_RATIO = 1;
const MOBILE_PDF_DEFAULT_ASPECT_RATIO = 11 / 8.5;
const MOBILE_RENDER_BEHIND_PAGES = 4;
const MOBILE_RENDER_AHEAD_PAGES = 8;

export default function ScriptViewerPage() {
  const nav = useNavigate();
  const { movieId, scriptId } = useParams();
  const [searchParams] = useSearchParams();

  const [movie, setMovie] = useState(null);
  const [script, setScript] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingSceneId, setDeletingSceneId] = useState("");
  const [loading, setLoading] = useState(true);
  const [numPages, setNumPages] = useState(0);
  const [visiblePageCount, setVisiblePageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(700);
  const [compactPdfMode, setCompactPdfMode] = useState(false);
  const [pdfLoadError, setPdfLoadError] = useState("");
  const [pageHeightsByNumber, setPageHeightsByNumber] = useState({});
  const [mobileRenderChunkStart, setMobileRenderChunkStart] = useState(1);
  const [activeSceneId, setActiveSceneId] = useState("");
  const [editingSceneId, setEditingSceneId] = useState("");
  const [expandedSceneById, setExpandedSceneById] = useState({});
  const [, setPendingDeepLinkSceneId] = useState("");
  const [pendingScrollPage, setPendingScrollPage] = useState(null);
  const [form, setForm] = useState(() => ({ ...EMPTY_SCENE_FORM }));
  const [formatStatus, setFormatStatus] = useState("idle");
  const [formatAccepted, setFormatAccepted] = useState(false);
  const [formatMessage, setFormatMessage] = useState("");

  const pagesWrapRef = useRef(null);
  const savedScenesRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const formatRequestRef = useRef(0);
  const savedScenesJumpRunRef = useRef(0);
  const savedScenesJumpTimeoutRef = useRef(null);
  const scrollRunRef = useRef(0);
  const lastDeepLinkedSceneRef = useRef("");
  const lastDeepLinkedPageRef = useRef("");
  const sceneIdFromQuery = searchParams.get("sceneId") || searchParams.get("annotationId");
  const pageFromQueryRaw = searchParams.get("page");
  const pageFromQuery =
    pageFromQueryRaw !== null &&
    Number.isInteger(Number(pageFromQueryRaw)) &&
    Number(pageFromQueryRaw) > 0
      ? Number(pageFromQueryRaw)
      : null;

  function measureRenderedPageHeight(pageNum) {
    if (typeof window === "undefined" || !Number.isInteger(pageNum)) return;

    window.requestAnimationFrame(() => {
      const pageElement = document.getElementById(`script-page-${pageNum}`);
      if (!pageElement) return;

      const renderedPage = pageElement.querySelector(".react-pdf__Page");
      const canvas = pageElement.querySelector("canvas");
      const measuredHeight = Math.round(
        Number(
          renderedPage?.getBoundingClientRect?.().height ||
            canvas?.getBoundingClientRect?.().height ||
            0
        )
      );

      if (!Number.isFinite(measuredHeight) || measuredHeight < 10) return;

      setPageHeightsByNumber((prev) => {
        if (prev[pageNum] === measuredHeight) return prev;
        return { ...prev, [pageNum]: measuredHeight };
      });
    });
  }

  function setFormFromScene(scene) {
    setForm(createSceneFormFromScene(scene));
    setFormatStatus("ready");
    setFormatAccepted(
      Boolean(
        typeof scene?.formatted_selected_text === "string" &&
          scene.formatted_selected_text.trim()
      )
    );
    setFormatMessage("");
  }

  function scrollToPageNumber(page, behavior = "auto", onDone) {
    const safePage = Number(page);
    if (!Number.isInteger(safePage) || safePage < 1) {
      if (typeof onDone === "function") onDone(false);
      return;
    }

    if (compactPdfMode) {
      setMobileRenderChunkStart(
        Math.floor(Math.max(0, safePage - 1) / MOBILE_PDF_BATCH_SIZE) * MOBILE_PDF_BATCH_SIZE + 1
      );
      setVisiblePageCount((prev) => {
        const current = Math.max(prev, MOBILE_PDF_BATCH_SIZE);
        const next = Math.max(current, safePage);
        return numPages > 0 ? Math.min(numPages, next) : next;
      });
    }

    const runId = ++scrollRunRef.current;
    const startedAt = Date.now();
    const maxWaitMs = 4500;

    const tryScroll = () => {
      if (runId !== scrollRunRef.current) return;

      const wrap = pagesWrapRef.current;
      const pageElement = document.getElementById(`script-page-${safePage}`);
      if (!wrap || !pageElement) {
        if (Date.now() - startedAt < maxWaitMs) {
          window.requestAnimationFrame(tryScroll);
          return;
        }
        if (typeof onDone === "function") onDone(false);
        return;
      }

      if (!isPageRendered(pageElement)) {
        if (Date.now() - startedAt < maxWaitMs) {
          window.requestAnimationFrame(tryScroll);
          return;
        }
        if (typeof onDone === "function") onDone(false);
        return;
      }

      scrollPageInWrap(wrap, pageElement, behavior);

      // Run one correction after layout settles to account for late PDF page sizing.
      window.setTimeout(() => {
        if (runId !== scrollRunRef.current) return;
        const currentWrap = pagesWrapRef.current;
        const currentPage = document.getElementById(`script-page-${safePage}`);
        if (!currentWrap || !currentPage) {
          if (typeof onDone === "function") onDone(false);
          return;
        }
        scrollPageInWrap(currentWrap, currentPage, "auto");
        if (typeof onDone === "function") onDone(true);
      }, 260);
    };

    tryScroll();
  }

  function scrollToScene(scene, behavior = "auto", onDone) {
    const page = Number(scene?.page_start || scene?.page_end || 1);
    scrollToPageNumber(page, behavior, onDone);
  }

  function activateScene(scene, options = {}) {
    const shouldScroll = options.scroll ?? true;
    const behavior = options.behavior || "auto";

    setActiveSceneId(scene.id);
    setEditingSceneId(scene.id);
    setExpandedSceneById((prev) => ({ ...prev, [scene.id]: true }));
    setFormFromScene(scene);
    setErr("");

    if (shouldScroll) {
      setTimeout(() => scrollToScene(scene, behavior), 60);
    }
  }

  function openFirstImageAnnotation(scene) {
    const annotationId = scene?.first_image_annotation?.id;
    if (!annotationId) return;

    const params = new URLSearchParams();
    params.set("annotationId", annotationId);
    nav(`/movies/${movieId}?${params.toString()}`);
  }

  function scrollSavedScenesIntoView(behavior = "smooth") {
    const target = savedScenesRef.current;
    if (!target || typeof window === "undefined") return false;

    const targetTop = window.scrollY + target.getBoundingClientRect().top - 12;
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
    return true;
  }

  function scheduleSavedScenesJump() {
    if (typeof window === "undefined") return;

    const runId = ++savedScenesJumpRunRef.current;
    if (savedScenesJumpTimeoutRef.current) {
      window.clearTimeout(savedScenesJumpTimeoutRef.current);
      savedScenesJumpTimeoutRef.current = null;
    }

    const jumpOnce = (behavior = "auto") => {
      if (runId !== savedScenesJumpRunRef.current) return;
      scrollSavedScenesIntoView(behavior);
    };

    window.requestAnimationFrame(() => {
      jumpOnce("smooth");
      window.requestAnimationFrame(() => {
        jumpOnce("auto");
      });
    });

    savedScenesJumpTimeoutRef.current = window.setTimeout(() => {
      savedScenesJumpTimeoutRef.current = null;
      jumpOnce("auto");
    }, 360);
  }

  function jumpToSavedScenes() {
    if (compactPdfMode && numPages > 0) {
      setVisiblePageCount(numPages);
      scheduleSavedScenesJump();
      return;
    }

    scrollSavedScenesIntoView("smooth");
  }

  async function load() {
    setErr("");
    setPdfLoadError("");
    setLoading(true);
    setNumPages(0);
    setVisiblePageCount(0);
    setPageHeightsByNumber({});
    setMobileRenderChunkStart(1);
    try {
      const [movieData, scriptData, sceneData] = await Promise.all([
        api.getMovie(movieId),
        api.getScript(movieId, scriptId),
        api.listScriptScenes(movieId, scriptId),
      ]);

      const sortedScenes = sortScriptScenes(Array.isArray(sceneData) ? sceneData : []);

      setMovie(movieData);
      setScript(scriptData);
      setScenes(sortedScenes);
    } catch (e) {
      setErr(e.message || "Failed to load script viewer");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId, scriptId]);

  useEffect(() => {
    if (!sceneIdFromQuery) {
      lastDeepLinkedSceneRef.current = "";
      setPendingDeepLinkSceneId("");
      return;
    }
    if (lastDeepLinkedSceneRef.current === sceneIdFromQuery) return;

    const target = scenes.find((row) => row.id === sceneIdFromQuery);
    if (!target) return;

    lastDeepLinkedSceneRef.current = sceneIdFromQuery;
    setPendingDeepLinkSceneId(target.id);
    setPendingScrollPage(Number(target.page_start || target.page_end || pageFromQuery || 1));
    activateScene(target, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdFromQuery, pageFromQuery, scenes]);

  useEffect(() => {
    const nextPageKey = pageFromQuery ? String(pageFromQuery) : "";
    if (!nextPageKey) {
      lastDeepLinkedPageRef.current = "";
      return;
    }
    if (lastDeepLinkedPageRef.current === nextPageKey) return;
    lastDeepLinkedPageRef.current = nextPageKey;
    setPendingScrollPage(pageFromQuery);
  }, [pageFromQuery]);

  useEffect(() => {
    if (!pendingScrollPage || numPages < 1) return;
    scrollToPageNumber(pendingScrollPage, "auto", () => {
      setPendingScrollPage(null);
      setPendingDeepLinkSceneId("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScrollPage, numPages]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const updateCompactPdfMode = () => {
      setCompactPdfMode(window.innerWidth <= MOBILE_PDF_BREAKPOINT);
    };

    updateCompactPdfMode();
    window.addEventListener("resize", updateCompactPdfMode);
    return () => window.removeEventListener("resize", updateCompactPdfMode);
  }, []);

  useEffect(() => {
    if (numPages < 1) {
      setVisiblePageCount(0);
      setMobileRenderChunkStart(1);
      return;
    }

    if (!compactPdfMode) {
      setVisiblePageCount(numPages);
      setMobileRenderChunkStart(1);
      return;
    }

    setVisiblePageCount((prev) => {
      const base = prev > 0 ? prev : MOBILE_PDF_BATCH_SIZE;
      return Math.min(numPages, Math.max(base, MOBILE_PDF_BATCH_SIZE));
    });
  }, [compactPdfMode, numPages]);

  useEffect(() => {
    if (!compactPdfMode) return undefined;
    if (typeof window === "undefined") return undefined;

    let rafId = 0;

    const updateRenderChunk = () => {
      rafId = 0;
      const wrap = pagesWrapRef.current;
      if (!wrap) return;

      const pageNodes = Array.from(wrap.querySelectorAll("[data-page-number]"));
      if (pageNodes.length === 0) return;

      const targetY = window.innerHeight * 0.45;
      let closestPage = Number(pageNodes[0].dataset.pageNumber || 1);
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const node of pageNodes) {
        const pageNum = Number(node.dataset.pageNumber);
        if (!Number.isInteger(pageNum)) continue;

        const rect = node.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const distance = Math.abs(centerY - targetY);
        if (distance < bestDistance) {
          bestDistance = distance;
          closestPage = pageNum;
        }
      }

      const nextChunkStart =
        Math.floor(Math.max(0, closestPage - 1) / MOBILE_PDF_BATCH_SIZE) * MOBILE_PDF_BATCH_SIZE + 1;
      setMobileRenderChunkStart((prev) => (prev === nextChunkStart ? prev : nextChunkStart));
    };

    const queueUpdate = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateRenderChunk);
    };

    queueUpdate();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
    };
  }, [compactPdfMode, visiblePageCount]);

  useEffect(() => {
    if (!compactPdfMode || visiblePageCount >= numPages) return undefined;

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setVisiblePageCount((prev) =>
        Math.min(numPages, Math.max(prev, MOBILE_PDF_BATCH_SIZE) + MOBILE_PDF_BATCH_SIZE)
      );
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisiblePageCount((prev) =>
          Math.min(numPages, Math.max(prev, MOBILE_PDF_BATCH_SIZE) + MOBILE_PDF_BATCH_SIZE)
        );
      },
      {
        root: null,
        rootMargin: MOBILE_PDF_ROOT_MARGIN,
        threshold: 0.01,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [compactPdfMode, numPages, visiblePageCount]);

  useEffect(() => {
    if (!pagesWrapRef.current) return;
    const el = pagesWrapRef.current;

    const update = () => {
      const horizontalPadding = compactPdfMode ? 8 : 24;
      const minWidth = compactPdfMode ? 220 : 280;
      const next = Math.max(minWidth, Math.floor(el.clientWidth - horizontalPadding));
      setPageWidth(next);
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compactPdfMode]);

  useEffect(() => {
    const el = pagesWrapRef.current;
    if (!el) return;

    const cancelAutoScroll = () => {
      scrollRunRef.current += 1;
      setPendingScrollPage(null);
    };

    el.addEventListener("wheel", cancelAutoScroll, { passive: true });
    el.addEventListener("touchstart", cancelAutoScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", cancelAutoScroll);
      el.removeEventListener("touchstart", cancelAutoScroll);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (savedScenesJumpTimeoutRef.current && typeof window !== "undefined") {
        window.clearTimeout(savedScenesJumpTimeoutRef.current);
      }
    };
  }, []);

  async function requestFormattedAnnotationText(rawText) {
    const requestId = ++formatRequestRef.current;
    setFormatStatus("loading");
    setFormatAccepted(false);
    setFormatMessage("");

    setForm((prev) => ({
      ...prev,
      raw_selected_text: rawText,
      formatted_selected_text: "",
      text_source: "raw",
    }));

    try {
      const result = await api.formatAnnotationText(rawText);
      if (requestId !== formatRequestRef.current) return;

      const formattedText =
        typeof result?.formattedText === "string" && result.formattedText.length > 0
          ? result.formattedText
          : rawText;
      const accepted = Boolean(result?.accepted) && Boolean(formattedText.trim());

      setForm((prev) => ({
        ...prev,
        raw_selected_text: rawText,
        formatted_selected_text: formattedText,
        text_source: accepted ? "formatted" : "raw",
      }));

      setFormatAccepted(accepted);
      setFormatStatus("ready");
      if (!accepted) {
        setFormatMessage("Formatter returned fallback text. Raw text will remain available.");
      }
    } catch {
      if (requestId !== formatRequestRef.current) return;
      setFormatStatus("failed");
      setFormatAccepted(false);
      setFormatMessage("Formatting failed. You can still save the raw selection.");
      setForm((prev) => ({
        ...prev,
        raw_selected_text: rawText,
        formatted_selected_text: "",
        text_source: "raw",
      }));
    }
  }

  function handleSelectFormattedText() {
    const rawText = String(form.raw_selected_text || "");
    if (!form.formatted_selected_text && rawText.trim() && formatStatus !== "loading") {
      void requestFormattedAnnotationText(rawText);
      return;
    }

    setForm((prev) => ({
      ...prev,
      text_source: "formatted",
      formatted_selected_text: prev.formatted_selected_text || prev.raw_selected_text,
    }));
  }

  function onPdfSelectionComplete() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    if (!selectionBelongsToRoot(selection, pagesWrapRef.current)) return;

    const rawText = selection.toString();
    if (!rawText.trim()) return;

    let pageStart = pageFromNode(selection.anchorNode);
    let pageEnd = pageFromNode(selection.focusNode);

    if (!pageStart && pageEnd) pageStart = pageEnd;
    if (!pageEnd && pageStart) pageEnd = pageStart;

    if (pageStart && pageEnd && pageStart > pageEnd) {
      const prevStart = pageStart;
      pageStart = pageEnd;
      pageEnd = prevStart;
    }

    const context = extractSelectionContext(selection);
    const selectionPayload = {
      raw_selected_text: rawText,
      page_start: pageStart || null,
      page_end: pageEnd || null,
    };

    const overlap = findOverlappingScriptScene(scenes, selectionPayload);
    if (overlap) {
      activateScene(overlap, { scroll: false });
      setInfo("Selection overlaps an existing scene. Editing that scene instead of creating a duplicate.");
      selection.removeAllRanges();
      return;
    }

    setActiveSceneId("");
    setEditingSceneId("");
    setInfo("New scene range selected. Add metadata and save.");
    setForm((prev) => ({
      ...EMPTY_SCENE_FORM,
      start_time_seconds: prev.start_time_seconds,
      end_time_seconds: prev.end_time_seconds,
      raw_selected_text: rawText,
      page_start: pageStart ? String(pageStart) : "",
      page_end: pageEnd ? String(pageEnd) : "",
      context_prefix: context.contextPrefix,
      context_suffix: context.contextSuffix,
      start_offset: Number.isInteger(context.startOffset) ? String(context.startOffset) : "",
      end_offset: Number.isInteger(context.endOffset) ? String(context.endOffset) : "",
      anchor_geometry: context.geometry,
    }));
    setFormatStatus("idle");
    setFormatAccepted(false);
    setFormatMessage("");
    void requestFormattedAnnotationText(rawText);
    selection.removeAllRanges();
  }

  function toggleTag(tag) {
    setForm((prev) => {
      const hasTag = prev.tags.includes(tag);
      return {
        ...prev,
        tags: hasTag ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
      };
    });
  }

  function resetForNewScene() {
    setEditingSceneId("");
    setActiveSceneId("");
    setInfo("");
    setForm({ ...EMPTY_SCENE_FORM });
    setFormatStatus("idle");
    setFormatAccepted(false);
    setFormatMessage("");
  }

  async function onSubmitScene(e) {
    e.preventDefault();
    setErr("");
    setInfo("");

    const { error, payload } = buildScriptScenePayload(form);
    if (error) {
      setErr(error);
      return;
    }

    setSaving(true);
    const wasEditing = Boolean(editingSceneId);

    try {
      const saved = wasEditing
        ? await scriptSceneActions.update(movieId, scriptId, editingSceneId, payload)
        : await scriptSceneActions.create(movieId, scriptId, payload);

      setScenes((prev) => sortScriptScenes([...prev.filter((row) => row.id !== saved.id), saved]));
      setActiveSceneId(saved.id);
      setEditingSceneId(saved.id);
      setExpandedSceneById((prev) => ({ ...prev, [saved.id]: true }));
      setFormFromScene(saved);
      setInfo(wasEditing ? "Scene annotation updated." : "Scene annotation saved.");
    } catch (e2) {
      setErr(e2.message || "Failed to save scene annotation");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteScene(sceneId) {
    if (!sceneId) return;
    setErr("");
    setInfo("");

    const scene = scenes.find((row) => row.id === sceneId);
    const label = displayScriptSceneText(scene).slice(0, 32) || "this scene";
    const ok = window.confirm(`Delete ${label}?`);
    if (!ok) return;

    setDeletingSceneId(sceneId);
    try {
      await scriptSceneActions.delete(movieId, scriptId, sceneId);
      setScenes((prev) => prev.filter((row) => row.id !== sceneId));
      setExpandedSceneById((prev) => {
        if (!prev[sceneId]) return prev;
        const next = { ...prev };
        delete next[sceneId];
        return next;
      });
      if (activeSceneId === sceneId || editingSceneId === sceneId) {
        resetForNewScene();
      }
      setInfo("Scene annotation deleted.");
    } catch (e) {
      setErr(e.message || "Failed to delete scene annotation");
    } finally {
      setDeletingSceneId("");
    }
  }

  const selectedCountText = useMemo(() => getSelectedCountText(form), [form]);
  const selectedTextPreview = getSelectedTextPreview(form);
  const scenesByPage = useMemo(() => groupScriptScenesByPage(scenes), [scenes]);

  const renderedPageCount = compactPdfMode ? visiblePageCount : numPages;
  const mobileRenderStart = compactPdfMode
    ? Math.max(1, mobileRenderChunkStart - MOBILE_RENDER_BEHIND_PAGES)
    : 1;
  const mobileRenderEnd = compactPdfMode
    ? Math.min(
        renderedPageCount,
        mobileRenderChunkStart + MOBILE_PDF_BATCH_SIZE + MOBILE_RENDER_AHEAD_PAGES - 1
      )
    : renderedPageCount;
  const defaultMobilePageHeight = (() => {
    const knownHeights = Object.values(pageHeightsByNumber).filter(
      (value) => Number.isFinite(value) && value > 10
    );
    if (knownHeights.length > 0) return Math.round(Number(knownHeights[0]));
    return Math.round(pageWidth * MOBILE_PDF_DEFAULT_ASPECT_RATIO);
  })();

  if (loading) {
    return (
      <div className={styles.wrap}>
        <p>Loading script viewer...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <ScriptViewerTopBar
        title={`${movie?.title || "Movie"} Script`}
        onBackToMovie={() => nav(`/movies/${movieId}`)}
        onSearchScripts={() => nav("/script-search")}
      />

      {err && <div className={styles.error}>{err}</div>}
      {info && <div className={styles.info}>{info}</div>}

      <div className={styles.layout}>
        <section className={styles.viewerPanel}>
          {!script?.script_url ? (
            <p>No script URL available.</p>
          ) : pdfLoadError ? (
            <div className={styles.viewerFallback}>
              <p>{pdfLoadError}</p>
            </div>
          ) : (
            <div
              ref={pagesWrapRef}
              className={styles.pagesWrap}
              onMouseUp={!compactPdfMode ? onPdfSelectionComplete : undefined}
            >
              <Document
                key={`${scriptId}:${script.script_url || ""}`}
                file={script.script_url}
                loading={<p>Loading PDF...</p>}
                onLoadSuccess={({ numPages: totalPages }) => {
                  setPdfLoadError("");
                  setNumPages(totalPages);
                }}
                onLoadError={(loadErr) => {
                  const message = loadErr?.message || "Unable to load this PDF.";
                  setPdfLoadError(message);
                  setErr(message);
                }}
              >
                {Array.from({ length: renderedPageCount }, (_, idx) => idx + 1).map((pageNum) => {
                  const pageScenes = scenesByPage.get(pageNum) || [];
                  const shouldRenderPage =
                    !compactPdfMode ||
                    (pageNum >= mobileRenderStart && pageNum <= mobileRenderEnd);
                  const estimatedPageHeight = pageHeightsByNumber[pageNum] || defaultMobilePageHeight;
                  return (
                    <div
                      id={`script-page-${pageNum}`}
                      key={pageNum}
                      data-page-number={String(pageNum)}
                      className={`${styles.pageCard} ${
                        pageScenes.some((row) => row.id === activeSceneId) ? styles.pageCardActive : ""
                      }`}
                    >
                      {pageScenes.length > 0 && (
                        <div className={styles.pageSceneBlocks}>
                          {pageScenes.map((scene) => {
                            const isActive = scene.id === activeSceneId;
                            const label = displayScriptSceneText(scene).slice(0, 72);
                            return (
                              <button
                                key={`${pageNum}-${scene.id}`}
                                type="button"
                                className={`${styles.pageSceneBlock} ${
                                  isActive ? styles.pageSceneBlockActive : ""
                                }`}
                                onClick={() => activateScene(scene, { scroll: false })}
                              >
                                <span className={styles.pageSceneTime}>
                                  {formatSecondsToHms(scene.start_time_seconds)}-{formatSecondsToHms(scene.end_time_seconds)}
                                </span>
                                <span className={styles.pageSceneLabel}>{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {shouldRenderPage ? (
                        <Page
                          pageNumber={pageNum}
                          width={pageWidth}
                          devicePixelRatio={compactPdfMode ? MOBILE_DEVICE_PIXEL_RATIO : undefined}
                          renderTextLayer={!compactPdfMode}
                          renderAnnotationLayer={!compactPdfMode}
                          onRenderSuccess={() => measureRenderedPageHeight(pageNum)}
                        />
                      ) : (
                        <div
                          className={styles.pagePlaceholder}
                          style={{ height: `${estimatedPageHeight}px` }}
                        />
                      )}
                    </div>
                  );
                })}
              </Document>
              {compactPdfMode && renderedPageCount < numPages && (
                <div ref={loadMoreSentinelRef} className={styles.pagesSentinel} aria-hidden="true" />
              )}
            </div>
          )}
        </section>

        <aside className={styles.sidebar}>
          <SceneAnnotationForm
            deletingSceneId={deletingSceneId}
            editingSceneId={editingSceneId}
            form={form}
            formatAccepted={formatAccepted}
            formatMessage={formatMessage}
            formatStatus={formatStatus}
            onDeleteScene={onDeleteScene}
            onNewScene={resetForNewScene}
            onSelectFormattedText={handleSelectFormattedText}
            onSubmitScene={onSubmitScene}
            onToggleTag={toggleTag}
            saving={saving}
            selectedCountText={selectedCountText}
            selectedTextPreview={selectedTextPreview}
            setForm={setForm}
          />

          <SavedScenesList
            ref={savedScenesRef}
            activeSceneId={activeSceneId}
            deletingSceneId={deletingSceneId}
            expandedSceneById={expandedSceneById}
            onDeleteScene={onDeleteScene}
            onOpenFirstImageAnnotation={openFirstImageAnnotation}
            onOpenScene={(scene) => activateScene(scene, { scroll: true })}
            onSelectScene={(scene) => {
              setActiveSceneId(scene.id);
              setEditingSceneId(scene.id);
              setFormFromScene(scene);
              setExpandedSceneById((prev) => ({
                ...prev,
                [scene.id]: !prev[scene.id],
              }));
            }}
            scenes={scenes}
          />
        </aside>
      </div>
      <button type="button" className={styles.mobileJumpBtn} onClick={jumpToSavedScenes}>
        Scenes
      </button>
    </div>
  );
}
