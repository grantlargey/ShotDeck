import { useEffect, useState } from "react";
import { pdfjs } from "react-pdf";
import { buildPageTextLines } from "@/shared/lib/pdf-text";
import { estimateActionMargin } from "@/shared/lib/screenplay";

const CONCURRENCY = 4;
const PUBLISH_EVERY_PAGES = 8;

const EMPTY_INDEX = {
  doc: null,
  pages: new Map(),
  complete: false,
  actionMargin: null,
  pageOffsets: null,
};

/**
 * Builds a line-level text index for every page of the loaded PDF in the
 * background. Anchor snapping, capture, and legacy re-anchoring all read from
 * it, so none of them depend on which pages are currently rendered.
 *
 * Extraction runs on its own pdf.js worker, fed the bytes the viewer already
 * downloaded, so it is not queued behind rendering every page's canvas.
 */
export function useScriptTextIndex(pdfDocument) {
  const [index, setIndex] = useState(EMPTY_INDEX);

  useEffect(() => {
    if (!pdfDocument) return undefined;

    let cancelled = false;
    let worker = null;
    let loadingTask = null;
    const pages = new Map();
    const total = pdfDocument.numPages;
    let nextPage = 1;
    let unpublished = 0;

    const publish = (complete) => {
      if (cancelled) return;
      const snapshot = new Map(pages);
      let pageOffsets = null;
      if (complete) {
        pageOffsets = new Map();
        let running = 0;
        for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
          pageOffsets.set(pageNumber, running);
          running += snapshot.get(pageNumber)?.textLength ?? 0;
        }
      }
      setIndex({
        doc: pdfDocument,
        pages: snapshot,
        complete,
        actionMargin: estimateActionMargin([...snapshot.values()]),
        pageOffsets,
      });
    };

    const indexPages = async (source) => {
      while (!cancelled && nextPage <= total) {
        const pageNumber = nextPage;
        nextPage += 1;
        try {
          const page = await source.getPage(pageNumber);
          const content = await page.getTextContent();
          if (cancelled) return;
          pages.set(pageNumber, buildPageTextLines(content, page.getViewport({ scale: 1 }), pageNumber));
          // Only free pages owned by the index document; the viewer's pages are still rendering.
          if (source !== pdfDocument) page.cleanup();
        } catch {
          // Pages without extractable text (scans) simply cannot be anchored.
        }
        unpublished += 1;
        if (unpublished >= PUBLISH_EVERY_PAGES) {
          unpublished = 0;
          publish(false);
        }
      }
    };

    const openIndexDocument = async () => {
      try {
        const data = await pdfDocument.getData();
        if (cancelled) return pdfDocument;
        worker = new pdfjs.PDFWorker();
        loadingTask = pdfjs.getDocument({ data, worker });
        return await loadingTask.promise;
      } catch {
        // Fall back to the viewer's own document (and worker) if a second
        // worker cannot start.
        return pdfDocument;
      }
    };

    openIndexDocument()
      .then((source) => Promise.all(Array.from({ length: CONCURRENCY }, () => indexPages(source))))
      .then(() => publish(true));

    return () => {
      cancelled = true;
      loadingTask?.destroy();
      worker?.destroy();
    };
  }, [pdfDocument]);

  return index.doc === pdfDocument ? index : EMPTY_INDEX;
}
