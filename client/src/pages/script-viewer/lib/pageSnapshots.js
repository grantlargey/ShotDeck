import { lineBoxAt } from "@/shared/lib/pdf-text/pageTextLines.js";

const TARGET_WIDTH_PX = 1100;
const MAX_PAGES = 6;
const CROP_MARGIN_PT = 36;
const JPEG_QUALITY = 0.72;

/**
 * Renders the pages covered by an anchor range to JPEG data URLs for the AI
 * formatter, cropping the first and last page to the selection. Long ranges
 * send their first and last pages only.
 */
export async function renderSelectionSnapshots(pdfDocument, anchors) {
  const { start, end } = anchors;
  const pageNumbers = [];
  for (let pageNumber = start.page; pageNumber <= end.page; pageNumber += 1) pageNumbers.push(pageNumber);

  const half = MAX_PAGES / 2;
  const chosen =
    pageNumbers.length <= MAX_PAGES ? pageNumbers : [...pageNumbers.slice(0, half), ...pageNumbers.slice(-half)];

  const pageImages = [];
  for (const pageNumber of chosen) {
    const page = await pdfDocument.getPage(pageNumber);
    const scale = TARGET_WIDTH_PX / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    const top =
      pageNumber === start.page
        ? Math.max(0, Math.floor((lineBoxAt(start.y).top - CROP_MARGIN_PT) * scale))
        : 0;
    const bottom =
      pageNumber === end.page
        ? Math.min(canvas.height, Math.ceil((lineBoxAt(end.y).bottom + CROP_MARGIN_PT) * scale))
        : canvas.height;

    const cropped = document.createElement("canvas");
    cropped.width = canvas.width;
    cropped.height = Math.max(1, bottom - top);
    cropped
      .getContext("2d")
      .drawImage(canvas, 0, top, canvas.width, cropped.height, 0, 0, canvas.width, cropped.height);

    pageImages.push({ page: pageNumber, dataUrl: cropped.toDataURL("image/jpeg", JPEG_QUALITY) });
  }

  return { pageImages, omittedPageCount: pageNumbers.length - chosen.length };
}
