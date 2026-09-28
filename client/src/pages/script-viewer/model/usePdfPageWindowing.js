import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
export function usePdfPageWindowing(pdfDocument, indexedPages = new Map()) {
  const numPages = pdfDocument?.numPages ?? 0;
  const [wrap, setWrap] = useState(null);
  const [sentinel, setSentinel] = useState(null);
  const [compact, setCompact] = useState(isCompactViewport);
  const [deviceRatio, setDeviceRatio] = useState(currentDevicePixelRatio);
  const [loadedCount, setLoadedCount] = useState(BATCH_SIZE);
  const [chunkStart, setChunkStart] = useState(1);
  const [pageHeights, setPageHeights] = useState({});
  const [pageWidth, setPageWidth] = useState(700);
  const scrollRunRef = useRef(0);
  const scrollCompleteRef = useRef(null);
  const widthRef = useRef(pageWidth);
  useLayoutEffect(() => { widthRef.current = pageWidth; }, [pageWidth]);
  useEffect(() => () => { scrollRunRef.current += 1; }, [pdfDocument]);

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
      scrollCompleteRef.current?.(false);
      scrollCompleteRef.current = null;
    };
    window.addEventListener("pointerdown", cancelAutoScroll, { passive: true });
    window.addEventListener("keydown", cancelAutoScroll);
    wrap.addEventListener("wheel", cancelAutoScroll, { passive: true });
    wrap.addEventListener("touchstart", cancelAutoScroll, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", cancelAutoScroll);
      window.removeEventListener("keydown", cancelAutoScroll);
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

  const onPageRendered = useCallback((pageNumber) => {
    // Heights only size the placeholders used by compact windowing.
    if (!compact) return;
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`script-page-${pageNumber}`);
      const height = Math.round(element?.querySelector(".react-pdf__Page")?.getBoundingClientRect().height || 0);
      if (height < 10) return;
      setPageHeights((prev) => (prev[pageNumber] === height ? prev : { ...prev, [pageNumber]: height }));
    });
  }, [compact]);

  async function scrollToPage(pageNumber, { behavior = "auto", offsetPt = null, onDone } = {}) {
    const target = Number(pageNumber);
    if (!Number.isInteger(target) || target < 1 || target > numPages) {
      onDone?.(false);
      return;
    }

    if (compact) {
      setChunkStart(chunkStartFor(target));
      setLoadedCount((prev) => Math.max(prev, target));
    }

    scrollRunRef.current += 1;
    const runId = scrollRunRef.current;
    scrollCompleteRef.current?.(false);
    scrollCompleteRef.current = onDone;
    const finish = (ok) => {
      if (runId !== scrollRunRef.current) return;
      scrollCompleteRef.current = null;
      onDone?.(ok);
    };
    // Read this page's real dimensions before converting points to pixels.
    // This works before the background text index reaches a deep-linked page.
    let pointWidth;
    try {
      const page = await pdfDocument.getPage(target);
      pointWidth = page.getViewport({ scale: 1 }).width;
    } catch {
      finish(false);
      return;
    }
    const startedAt = Date.now();
    const scroll = (element, mode) => {
      const canvasWidth = element.querySelector(".react-pdf__Page")?.getBoundingClientRect().width;
      const scale = (canvasWidth || widthRef.current) / pointWidth;
      scrollPageInWrap(wrap, element, mode, offsetPt === null ? null : offsetPt * scale);
    };

    const attempt = () => {
      if (runId !== scrollRunRef.current) return;
      const element = document.getElementById(`script-page-${target}`);
      if (!wrap || !element || !isPageRendered(element)) {
        if (Date.now() - startedAt < SCROLL_WAIT_MS) window.requestAnimationFrame(attempt);
        else finish(false);
        return;
      }

      scroll(element, behavior);
      if (behavior === "smooth") {
        finish(true);
        return;
      }

      // One correction after layout settles, for late PDF page sizing.
      window.setTimeout(() => {
        if (runId !== scrollRunRef.current) return;
        scroll(element, "auto");
        finish(true);
      }, 260);
    };

    attempt();
  }

  return {
    wrapRef: setWrap,
    sentinelRef: setSentinel,
    pages: Array.from({ length: renderedPageCount }, (_, index) => {
      const pageNumber = index + 1;
      const pageIndex = indexedPages.get(pageNumber) ?? null;
      const inWindow = pageNumber >= renderStart && pageNumber <= renderEnd;
      const scale = pageIndex ? pageWidth / pageIndex.width : 0;
      return {
        pageNumber, pageIndex, pageWidth, inWindow, compact, scale,
        devicePixelRatio: pixelRatio,
        placeholderHeight: pageIndex ? pageIndex.height * scale : pageHeights[pageNumber] || defaultPageHeight,
        onRendered: onPageRendered,
      };
    }),
    hasMore: renderedPageCount < numPages,
    scrollToPage,
    revealAllPages: () => setLoadedCount(numPages),
  };
}
