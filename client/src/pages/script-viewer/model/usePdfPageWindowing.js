import { useEffect, useRef, useState } from "react";
import { isPageRendered, scrollPageInWrap } from "../lib/pdfViewport.js";

const COMPACT_BREAKPOINT = 900;
const BATCH_SIZE = 4;
const LOAD_MORE_ROOT_MARGIN = "900px 0px";
const RENDER_BEHIND = 4;
const RENDER_AHEAD = 8;
const DEFAULT_ASPECT_RATIO = 11 / 8.5;
const MAX_PAGE_WIDTH = 880;
// Compact layouts keep a window of up to ~16 page canvases alive, so each is
// capped to stay well inside mobile browsers' canvas memory limits.
const MAX_COMPACT_PIXEL_RATIO = 3;
const MAX_COMPACT_CANVAS_PIXELS = 4_000_000;
const SCROLL_WAIT_MS = 4500;

function isCompactViewport() {
  return typeof window !== "undefined" && window.innerWidth <= COMPACT_BREAKPOINT;
}

function currentDevicePixelRatio() {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

function chunkStartFor(pageNumber) {
  return Math.floor(Math.max(0, pageNumber - 1) / BATCH_SIZE) * BATCH_SIZE + 1;
}

/**
 * Page sizing, windowing, and scrolling for the PDF viewer. Desktop renders
 * every page; compact (mobile) layouts render a window of pages around the
 * reading position and grow the list as the user scrolls.
 */
export function usePdfPageWindowing(numPages) {
  const [wrap, setWrap] = useState(null);
  const [sentinel, setSentinel] = useState(null);
  const [compact, setCompact] = useState(isCompactViewport);
  const [deviceRatio, setDeviceRatio] = useState(currentDevicePixelRatio);
  const [loadedCount, setLoadedCount] = useState(BATCH_SIZE);
  const [chunkStart, setChunkStart] = useState(1);
  const [pageHeights, setPageHeights] = useState({});
  const [pageWidth, setPageWidth] = useState(700);
  const scrollRunRef = useRef(0);

  const renderedPageCount = compact ? Math.min(numPages, loadedCount) : numPages;
  const renderStart = compact ? Math.max(1, chunkStart - RENDER_BEHIND) : 1;
  const renderEnd = compact
    ? Math.min(renderedPageCount, chunkStart + BATCH_SIZE + RENDER_AHEAD - 1)
    : renderedPageCount;
  const knownHeight = Object.values(pageHeights).find((height) => height > 10);
  const defaultPageHeight = Math.round(knownHeight || pageWidth * DEFAULT_ASPECT_RATIO);
  // Desktop leaves this to react-pdf (the screen's full ratio). Compact pages
  // also match the screen so text stays sharp, within the per-canvas cap.
  const pixelRatio = compact
    ? Math.max(
        1,
        Math.min(
          deviceRatio,
          MAX_COMPACT_PIXEL_RATIO,
          Math.sqrt(MAX_COMPACT_CANVAS_PIXELS / (pageWidth * pageWidth * DEFAULT_ASPECT_RATIO))
        )
      )
    : undefined;

  useEffect(() => {
    const update = () => {
      setCompact(isCompactViewport());
      setDeviceRatio(currentDevicePixelRatio());
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Measured from the wrap element itself (a callback ref), so sizing starts
  // as soon as the viewer mounts after data loads.
  useEffect(() => {
    if (!wrap) return undefined;
    let lastWidth = -1;
    const update = () => {
      const computed = window.getComputedStyle(wrap);
      const padding = parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight);
      const width = Math.min(MAX_PAGE_WIDTH, Math.max(compact ? 220 : 280, Math.floor(wrap.clientWidth - padding)));
      if (width === lastWidth) return;
      lastWidth = width;
      setPageWidth(width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [wrap, compact]);

  useEffect(() => {
    if (!wrap) return undefined;
    const cancelAutoScroll = () => {
      scrollRunRef.current += 1;
    };
    wrap.addEventListener("wheel", cancelAutoScroll, { passive: true });
    wrap.addEventListener("touchstart", cancelAutoScroll, { passive: true });
    return () => {
      wrap.removeEventListener("wheel", cancelAutoScroll);
      wrap.removeEventListener("touchstart", cancelAutoScroll);
    };
  }, [wrap]);

  useEffect(() => {
    if (!compact || !wrap) return undefined;
    let frame = 0;

    const updateChunk = () => {
      frame = 0;
      const targetY = window.innerHeight * 0.45;
      let closestPage = null;
      let bestDistance = Infinity;
      for (const node of wrap.querySelectorAll("[data-page-number]")) {
        const rect = node.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - targetY);
        if (distance < bestDistance) {
          bestDistance = distance;
          closestPage = Number(node.dataset.pageNumber);
        }
      }
      if (closestPage) setChunkStart(chunkStartFor(closestPage));
    };

    const queueUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateChunk);
    };

    queueUpdate();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
    };
  }, [compact, wrap, renderedPageCount]);

  useEffect(() => {
    if (!compact || !sentinel || renderedPageCount >= numPages) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setLoadedCount((prev) => Math.min(numPages, Math.max(prev, BATCH_SIZE) + BATCH_SIZE));
      },
      { rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0.01 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [compact, sentinel, renderedPageCount, numPages]);

  function onPageRendered(pageNumber) {
    // Heights only size the placeholders used by compact windowing.
    if (!compact) return;
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`script-page-${pageNumber}`);
      const height = Math.round(element?.querySelector(".react-pdf__Page")?.getBoundingClientRect().height || 0);
      if (height < 10) return;
      setPageHeights((prev) => (prev[pageNumber] === height ? prev : { ...prev, [pageNumber]: height }));
    });
  }

  function scrollToPage(pageNumber, { behavior = "auto", offsetPx = null, onDone } = {}) {
    const target = Number(pageNumber);
    if (!Number.isInteger(target) || target < 1) {
      onDone?.(false);
      return;
    }

    if (compact) {
      setChunkStart(chunkStartFor(target));
      setLoadedCount((prev) => Math.max(prev, target));
    }

    scrollRunRef.current += 1;
    const runId = scrollRunRef.current;
    const startedAt = Date.now();

    const attempt = () => {
      if (runId !== scrollRunRef.current) return;
      const element = document.getElementById(`script-page-${target}`);
      if (!wrap || !element || !isPageRendered(element)) {
        if (Date.now() - startedAt < SCROLL_WAIT_MS) window.requestAnimationFrame(attempt);
        else onDone?.(false);
        return;
      }

      scrollPageInWrap(wrap, element, behavior, offsetPx);
      if (behavior === "smooth") {
        onDone?.(true);
        return;
      }

      // One correction after layout settles, for late PDF page sizing.
      window.setTimeout(() => {
        if (runId !== scrollRunRef.current) return;
        scrollPageInWrap(wrap, element, "auto", offsetPx);
        onDone?.(true);
      }, 260);
    };

    attempt();
  }

  return {
    wrapRef: setWrap,
    sentinelRef: setSentinel,
    compact,
    pageWidth,
    pixelRatio,
    renderedPageCount,
    renderStart,
    renderEnd,
    pageHeights,
    defaultPageHeight,
    onPageRendered,
    scrollToPage,
    revealAllPages: () => setLoadedCount(numPages),
  };
}
