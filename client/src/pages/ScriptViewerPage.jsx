import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { api } from "../api";
import { SCRIPT_TAG_CATEGORIES, getScriptTagLabel } from "../constants/scriptTagCategories";
import { formatSecondsToHms, parseTimeInputToSeconds } from "../utils/time";
import styles from "./ScriptViewerPage.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function pageFromNode(node) {
  let current = node;
  while (current) {
    if (current.nodeType === 1 && current.dataset?.pageNumber) {
      const pageNum = Number(current.dataset.pageNumber);
      return Number.isFinite(pageNum) ? pageNum : null;
    }
    current = current.parentNode;
  }
  return null;
}

function safeTags(tags) {
  return Array.isArray(tags) ? tags.map(String) : [];
}

function displaySceneText(item) {
  if (typeof item?.formatted_selected_text === "string" && item.formatted_selected_text.trim()) {
    return item.formatted_selected_text;
  }
  if (typeof item?.raw_selected_text === "string" && item.raw_selected_text.trim()) {
    return item.raw_selected_text;
  }
  return item?.selected_text || "";
}

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

function findOverlappingScene(scenes, selection) {
  const selectedNorm = normalizeComparableText(selection.raw_selected_text);
  if (!selectedNorm) return null;

  let best = null;
  let bestScore = -1;

  for (const scene of scenes) {
    const sceneNorm = normalizeComparableText(scene.raw_selected_text || scene.selected_text || "");
    if (!sceneNorm) continue;

    const selectionPageStart = Number(selection.page_start || selection.page_end || 1);
    const selectionPageEnd = Number(selection.page_end || selection.page_start || selectionPageStart);
    const scenePageStart = Number(scene.page_start || scene.page_end || 1);
    const scenePageEnd = Number(scene.page_end || scene.page_start || scenePageStart);

    const pageOverlap = rangesOverlap(selectionPageStart, selectionPageEnd, scenePageStart, scenePageEnd);
    const exactText = selectedNorm === sceneNorm;
    const partialText = selectedNorm.includes(sceneNorm) || sceneNorm.includes(selectedNorm);

    let score = 0;
    if (pageOverlap) score += 2;
    if (exactText) score += 4;
    else if (partialText) score += 2;

    if (score > bestScore) {
      best = scene;
      bestScore = score;
    }
  }

  return bestScore >= 4 ? best : null;
}

function sortScenes(rows) {
  return [...rows].sort((a, b) => {
    const pageA = Number(a.page_start || a.page_end || 1);
    const pageB = Number(b.page_start || b.page_end || 1);
    if (pageA !== pageB) return pageA - pageB;

    const startA = Number(a.start_time_seconds || 0);
    const startB = Number(b.start_time_seconds || 0);
    if (startA !== startB) return startA - startB;

    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}

function isPageRendered(pageElement) {
  if (!pageElement) return false;

  const canvas = pageElement.querySelector("canvas");
  if (canvas && canvas.clientHeight > 0 && canvas.clientWidth > 0) return true;

  return pageElement.getBoundingClientRect().height > 160;
}

function scrollPageInWrap(wrap, pageElement, behavior = "auto") {
  if (!wrap || !pageElement) return;

  const targetTop = pageElement.offsetTop - (wrap.clientHeight / 2 - pageElement.offsetHeight / 2);
  const maxTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
  const clampedTop = Math.min(maxTop, Math.max(0, targetTop));

  wrap.scrollTo({
    top: clampedTop,
    behavior,
  });
}

const EMPTY_FORM = {
  start_time_seconds: "",
  end_time_seconds: "",
  raw_selected_text: "",
  formatted_selected_text: "",
  text_source: "raw",
  page_start: "",
  page_end: "",
  context_prefix: "",
  context_suffix: "",
  start_offset: "",
  end_offset: "",
  anchor_geometry: [],
  tags: [],
};

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
  const [pageWidth, setPageWidth] = useState(700);
  const [activeSceneId, setActiveSceneId] = useState("");
  const [editingSceneId, setEditingSceneId] = useState("");
  const [expandedSceneById, setExpandedSceneById] = useState({});
  const [, setPendingDeepLinkSceneId] = useState("");
  const [pendingScrollPage, setPendingScrollPage] = useState(null);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }));
  const [formatStatus, setFormatStatus] = useState("idle");
  const [formatAccepted, setFormatAccepted] = useState(false);
  const [formatMessage, setFormatMessage] = useState("");

  const pagesWrapRef = useRef(null);
  const formatRequestRef = useRef(0);
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

  function setFormFromScene(scene) {
    const fallbackFormatted =
      scene?.formatted_selected_text || scene?.raw_selected_text || scene?.selected_text || "";

    setForm({
      start_time_seconds:
        scene?.start_time_seconds === null || scene?.start_time_seconds === undefined
          ? ""
          : formatSecondsToHms(scene.start_time_seconds, { fallback: "00:00:00" }),
      end_time_seconds:
        scene?.end_time_seconds === null || scene?.end_time_seconds === undefined
          ? ""
          : formatSecondsToHms(scene.end_time_seconds, { fallback: "00:00:00" }),
      raw_selected_text: scene?.raw_selected_text || scene?.selected_text || "",
      formatted_selected_text: fallbackFormatted,
      text_source:
        typeof scene?.formatted_selected_text === "string" && scene.formatted_selected_text.trim()
          ? "formatted"
          : "raw",
      page_start:
        scene?.page_start === null || scene?.page_start === undefined ? "" : String(scene.page_start),
      page_end:
        scene?.page_end === null || scene?.page_end === undefined ? "" : String(scene.page_end),
      context_prefix: scene?.context_prefix || "",
      context_suffix: scene?.context_suffix || "",
      start_offset:
        scene?.start_offset === null || scene?.start_offset === undefined
          ? ""
          : String(scene.start_offset),
      end_offset:
        scene?.end_offset === null || scene?.end_offset === undefined
          ? ""
          : String(scene.end_offset),
      anchor_geometry: Array.isArray(scene?.anchor_geometry) ? scene.anchor_geometry : [],
      tags: safeTags(scene?.tags),
    });
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

  async function load() {
    setErr("");
    setLoading(true);
    setNumPages(0);
    try {
      const [movieData, scriptData, sceneData] = await Promise.all([
        api.getMovie(movieId),
        api.getScript(movieId, scriptId),
        api.listScriptScenes(movieId, scriptId),
      ]);

      const sortedScenes = sortScenes(Array.isArray(sceneData) ? sceneData : []);

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
  }, [pendingScrollPage, numPages]);

  useEffect(() => {
    if (!pagesWrapRef.current) return;
    const el = pagesWrapRef.current;

    const update = () => {
      const next = Math.max(280, Math.floor(el.clientWidth - 24));
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
  }, []);

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

  function extractSelectionContext(selection) {
    if (!selection || selection.rangeCount < 1) {
      return {
        contextPrefix: "",
        contextSuffix: "",
        startOffset: null,
        endOffset: null,
        geometry: [],
      };
    }

    try {
      const range = selection.getRangeAt(0);

      const beforeRange = range.cloneRange();
      beforeRange.selectNodeContents(range.commonAncestorContainer);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeText = beforeRange.toString();

      const afterRange = range.cloneRange();
      afterRange.selectNodeContents(range.commonAncestorContainer);
      afterRange.setStart(range.endContainer, range.endOffset);
      const afterText = afterRange.toString();

      const selectedText = selection.toString();
      const startOffset = beforeText.length;
      const endOffset = startOffset + selectedText.length;

      const geometry = Array.from(range.getClientRects()).map((rect) => ({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }));

      return {
        contextPrefix: beforeText.slice(-180),
        contextSuffix: afterText.slice(0, 180),
        startOffset,
        endOffset,
        geometry,
      };
    } catch {
      return {
        contextPrefix: "",
        contextSuffix: "",
        startOffset: null,
        endOffset: null,
        geometry: [],
      };
    }
  }

  function onPdfMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

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

    const overlap = findOverlappingScene(scenes, selectionPayload);
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
      ...EMPTY_FORM,
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
    setForm({ ...EMPTY_FORM });
    setFormatStatus("idle");
    setFormatAccepted(false);
    setFormatMessage("");
  }

  async function onSubmitScene(e) {
    e.preventDefault();
    setErr("");
    setInfo("");

    const start = parseTimeInputToSeconds(form.start_time_seconds);
    const end = parseTimeInputToSeconds(form.end_time_seconds);
    const pageStart = form.page_start === "" ? null : Number(form.page_start);
    const pageEnd = form.page_end === "" ? null : Number(form.page_end);
    const startOffset = form.start_offset === "" ? null : Number(form.start_offset);
    const endOffset = form.end_offset === "" ? null : Number(form.end_offset);

    if (start === null || end === null || start < 0 || end < start) {
      setErr("Start/end time must use HH:MM:SS (or MM:SS) where end >= start.");
      return;
    }

    if (
      (pageStart !== null && (!Number.isInteger(pageStart) || pageStart < 1)) ||
      (pageEnd !== null && (!Number.isInteger(pageEnd) || pageEnd < 1)) ||
      (pageStart !== null && pageEnd !== null && pageEnd < pageStart)
    ) {
      setErr("Page range must be positive integers and page_end >= page_start.");
      return;
    }

    if (
      (startOffset !== null && (!Number.isInteger(startOffset) || startOffset < 0)) ||
      (endOffset !== null && (!Number.isInteger(endOffset) || endOffset < 0)) ||
      (startOffset !== null && endOffset !== null && endOffset < startOffset)
    ) {
      setErr("Offsets must be non-negative integers and end_offset >= start_offset.");
      return;
    }

    if (!form.raw_selected_text.trim()) {
      setErr("Select text in the PDF first.");
      return;
    }

    const selectedTextToSave =
      form.text_source === "formatted" && form.formatted_selected_text
        ? form.formatted_selected_text
        : form.raw_selected_text;

    const payload = {
      start_time_seconds: start,
      end_time_seconds: end,
      selected_text: selectedTextToSave,
      raw_selected_text: form.raw_selected_text,
      formatted_selected_text: form.formatted_selected_text || null,
      page_start: pageStart,
      page_end: pageEnd,
      context_prefix: form.context_prefix || null,
      context_suffix: form.context_suffix || null,
      start_offset: startOffset,
      end_offset: endOffset,
      anchor_geometry: Array.isArray(form.anchor_geometry) ? form.anchor_geometry : [],
      tags: form.tags,
    };

    setSaving(true);
    const wasEditing = Boolean(editingSceneId);

    try {
      const saved = wasEditing
        ? await api.updateScriptScene(movieId, scriptId, editingSceneId, payload)
        : await api.createScriptScene(movieId, scriptId, payload);

      setScenes((prev) => sortScenes([...prev.filter((row) => row.id !== saved.id), saved]));
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
    const label = displaySceneText(scene).slice(0, 32) || "this scene";
    const ok = window.confirm(`Delete ${label}?`);
    if (!ok) return;

    setDeletingSceneId(sceneId);
    try {
      await api.deleteScriptScene(movieId, scriptId, sceneId);
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

  const selectedCountText = useMemo(() => {
    const len = form.raw_selected_text.trim().length;
    if (!len) return "No text selected yet.";
    if (len <= 140) return form.raw_selected_text.trim();
    return `${form.raw_selected_text.trim().slice(0, 140)}...`;
  }, [form.raw_selected_text]);

  const selectedTextPreview =
    form.text_source === "formatted" && form.formatted_selected_text
      ? form.formatted_selected_text
      : form.raw_selected_text;

  const scenesByPage = useMemo(() => {
    const pageMap = new Map();
    for (const scene of scenes) {
      const start = Number(scene.page_start || scene.page_end || 1);
      const end = Number(scene.page_end || scene.page_start || start);
      const from = Math.max(1, Math.min(start, end));
      const to = Math.max(from, Math.max(start, end));

      for (let page = from; page <= to; page += 1) {
        if (!pageMap.has(page)) pageMap.set(page, []);
        pageMap.get(page).push(scene);
      }
    }

    for (const [page, rows] of pageMap.entries()) {
      pageMap.set(page, sortScenes(rows));
    }

    return pageMap;
  }, [scenes]);

  if (loading) {
    return (
      <div className={styles.wrap}>
        <p>Loading script viewer...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>{movie?.title || "Movie"} Script</h1>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => nav(`/movies/${movieId}`)}
          >
            Back To Movie
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => nav("/script-search")}>
            Search All Scripts
          </button>
        </div>
      </div>

      {err && <div className={styles.error}>{err}</div>}
      {info && <div className={styles.info}>{info}</div>}

      <div className={styles.layout}>
        <section className={styles.viewerPanel}>
          {!script?.script_url ? (
            <p>No script URL available.</p>
          ) : (
            <div ref={pagesWrapRef} className={styles.pagesWrap} onMouseUp={onPdfMouseUp}>
              <Document
                key={`${scriptId}:${script.script_url || ""}`}
                file={script.script_url}
                loading={<p>Loading PDF...</p>}
                onLoadSuccess={({ numPages: totalPages }) => setNumPages(totalPages)}
                onLoadError={(loadErr) => setErr(loadErr?.message || "Unable to load this PDF.")}
              >
                {Array.from({ length: numPages }, (_, idx) => idx + 1).map((pageNum) => {
                  const pageScenes = scenesByPage.get(pageNum) || [];
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
                            const label = displaySceneText(scene).slice(0, 72);
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
                      <Page
                        pageNumber={pageNum}
                        width={pageWidth}
                        renderTextLayer
                        renderAnnotationLayer
                      />
                    </div>
                  );
                })}
              </Document>
            </div>
          )}
        </section>

        <aside className={styles.sidebar}>
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <h2 className={styles.cardTitle}>
                {editingSceneId ? "Edit Scene Annotation" : "New Scene Annotation"}
              </h2>
              <button type="button" className={styles.smallBtn} onClick={resetForNewScene}>
                New
              </button>
            </div>
            <p className={styles.subtle}>
              Select text in the PDF to anchor a scene. Selecting an already-anchored range opens the
              existing scene.
            </p>

            <form onSubmit={onSubmitScene} className={styles.form}>
              <div className={styles.row}>
                <label className={styles.label}>
                  Start Time (HH:MM:SS)
                  <input
                    type="text"
                    value={form.start_time_seconds}
                    onChange={(e) => setForm((prev) => ({ ...prev, start_time_seconds: e.target.value }))}
                    onBlur={(e) => {
                      const parsed = parseTimeInputToSeconds(e.target.value);
                      if (parsed !== null) {
                        setForm((prev) => ({
                          ...prev,
                          start_time_seconds: formatSecondsToHms(parsed, { fallback: "00:00:00" }),
                        }));
                      }
                    }}
                    placeholder="00:00:00"
                    className={styles.input}
                    required
                  />
                </label>

                <label className={styles.label}>
                  End Time (HH:MM:SS)
                  <input
                    type="text"
                    value={form.end_time_seconds}
                    onChange={(e) => setForm((prev) => ({ ...prev, end_time_seconds: e.target.value }))}
                    onBlur={(e) => {
                      const parsed = parseTimeInputToSeconds(e.target.value);
                      if (parsed !== null) {
                        setForm((prev) => ({
                          ...prev,
                          end_time_seconds: formatSecondsToHms(parsed, { fallback: "00:00:00" }),
                        }));
                      }
                    }}
                    placeholder="00:00:00"
                    className={styles.input}
                    required
                  />
                </label>
              </div>

              <div className={styles.row}>
                <label className={styles.label}>
                  Page Start
                  <input
                    type="number"
                    min="1"
                    value={form.page_start}
                    onChange={(e) => setForm((prev) => ({ ...prev, page_start: e.target.value }))}
                    className={styles.input}
                  />
                </label>

                <label className={styles.label}>
                  Page End
                  <input
                    type="number"
                    min="1"
                    value={form.page_end}
                    onChange={(e) => setForm((prev) => ({ ...prev, page_end: e.target.value }))}
                    className={styles.input}
                  />
                </label>
              </div>

              <div className={styles.row}>
                <label className={styles.label}>
                  Start Offset
                  <input
                    type="number"
                    min="0"
                    value={form.start_offset}
                    onChange={(e) => setForm((prev) => ({ ...prev, start_offset: e.target.value }))}
                    className={styles.input}
                  />
                </label>

                <label className={styles.label}>
                  End Offset
                  <input
                    type="number"
                    min="0"
                    value={form.end_offset}
                    onChange={(e) => setForm((prev) => ({ ...prev, end_offset: e.target.value }))}
                    className={styles.input}
                  />
                </label>
              </div>

              <div className={styles.label}>
                <span>Selected Text</span>
                {formatStatus === "loading" && <p className={styles.formatState}>Formatting selection...</p>}
                {formatMessage && <p className={styles.formatState}>{formatMessage}</p>}

                <div className={styles.choiceRow}>
                  <label className={styles.choiceLabel}>
                    <input
                      type="radio"
                      name="text_source"
                      value="formatted"
                      checked={form.text_source === "formatted"}
                      onChange={handleSelectFormattedText}
                    />
                    Use formatted text{formatAccepted ? " (Recommended)" : ""}
                  </label>
                  <label className={styles.choiceLabel}>
                    <input
                      type="radio"
                      name="text_source"
                      value="raw"
                      checked={form.text_source === "raw"}
                      onChange={() => setForm((prev) => ({ ...prev, text_source: "raw" }))}
                    />
                    Use raw text
                  </label>
                </div>

                <textarea value={selectedTextPreview} rows={7} className={styles.textarea} readOnly />
              </div>
              <p className={styles.selectionPreview}>{selectedCountText}</p>

              {SCRIPT_TAG_CATEGORIES.map((group) => (
                <fieldset key={group.key} className={styles.tagGroup}>
                  <legend>{group.label}</legend>
                  <div className={styles.tagsGrid}>
                    {group.tags.map((tag) => (
                      <label key={tag.value} className={styles.tagChip}>
                        <input
                          type="checkbox"
                          checked={form.tags.includes(tag.value)}
                          onChange={() => toggleTag(tag.value)}
                        />
                        {tag.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}

              <div className={styles.actionRow}>
                <button className={styles.saveBtn} type="submit" disabled={saving}>
                  {saving ? "Saving..." : editingSceneId ? "Update Scene" : "Save Scene"}
                </button>
                {editingSceneId && (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    disabled={deletingSceneId === editingSceneId}
                    onClick={() => onDeleteScene(editingSceneId)}
                  >
                    {deletingSceneId === editingSceneId ? "Deleting..." : "Delete Scene"}
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Saved Script Scenes</h2>
            {scenes.length === 0 ? (
              <p className={styles.subtle}>No scene annotations yet.</p>
            ) : (
              <ul className={styles.annotationList}>
                {scenes.map((item) => {
                  const tags = safeTags(item.tags);
                  const page = Number(item.page_start || item.page_end || 1);
                  const isActive = activeSceneId === item.id;
                  const isExpanded = Boolean(expandedSceneById[item.id]);
                  const previewText = displaySceneText(item);
                  return (
                    <li
                      key={item.id}
                      className={`${styles.annotationItem} ${isActive ? styles.annotationItemActive : ""} ${
                        isExpanded ? styles.annotationItemExpanded : ""
                      }`}
                    >
                      <button
                        type="button"
                        className={styles.scenePreviewBtn}
                        onClick={() => {
                          setActiveSceneId(item.id);
                          setEditingSceneId(item.id);
                          setFormFromScene(item);
                          setExpandedSceneById((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id],
                          }));
                        }}
                      >
                        <div className={styles.scenePreviewTop}>
                          <div className={styles.annotationMeta}>
                            {formatSecondsToHms(item.start_time_seconds)} - {formatSecondsToHms(item.end_time_seconds)} | Page {page}
                          </div>
                          <span className={styles.sceneExpandHint}>{isExpanded ? "Collapse" : "Expand"}</span>
                        </div>
                        <p className={styles.scenePreviewText}>{previewText}</p>
                        {tags.length > 0 && (
                          <div className={styles.annotationTags}>
                            {tags.slice(0, 6).map((tag) => (
                              <span key={tag}>{getScriptTagLabel(tag)}</span>
                            ))}
                          </div>
                        )}
                      </button>

                      {isExpanded && (
                        <div className={styles.sceneExpandedBody}>
                          <p className={styles.annotationText}>{displaySceneText(item)}</p>
                          <div className={styles.sceneActions}>
                            <button
                              type="button"
                              className={styles.jumpBtn}
                              onClick={() => activateScene(item, { scroll: true })}
                            >
                              Open Scene
                            </button>
                            <button
                              type="button"
                              className={styles.jumpBtn}
                              disabled={!item.first_image_annotation?.id}
                              title={
                                item.first_image_annotation?.id
                                  ? `Open first image annotation at ${formatSecondsToHms(
                                      item.first_image_annotation.time_seconds
                                    )}`
                                  : "No image annotation falls inside this scene's timeframe."
                              }
                              onClick={() => openFirstImageAnnotation(item)}
                            >
                              Open First Image
                            </button>
                            <button
                              type="button"
                              className={styles.rowDeleteBtn}
                              disabled={deletingSceneId === item.id}
                              onClick={() => onDeleteScene(item.id)}
                            >
                              {deletingSceneId === item.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
