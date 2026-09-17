import {
  screenplayToPlainText,
  serializeScreenplayMarkdown,
} from "@/shared/lib/screenplay/grammar.js";
import {
  estimateActionMargin,
  screenplayElementsFromLayout,
} from "@/shared/lib/screenplay/layoutClassifier.js";
import { isValidScriptLocation } from "@/entities/script-scene/model/scriptLocation.js";
import { anchorPairKey, resolveAnchorLine } from "./anchors.js";

/** The indexed pages from the start anchor's page to the end anchor's, or null while any is missing. */
function rangePages(textIndex, start, end) {
  const pages = [];
  for (let pageNumber = start.page; pageNumber <= end.page; pageNumber += 1) {
    const page = textIndex.pages.get(pageNumber);
    if (!page) return null;
    pages.push(page);
  }
  return pages;
}

/**
 * Captures the script text between two line anchors from the PDF text index
 * and converts it to screenplay markdown by page layout. Returns null until
 * both anchors are placed and every page in the range has been indexed.
 */
export function captureAnchoredRange(textIndex, anchors) {
  const { start, end } = anchors || {};
  if (!isValidScriptLocation(anchors)) return null;

  const pages = rangePages(textIndex, start, end);
  if (!pages) return null;

  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const startLine = resolveAnchorLine(firstPage, start);
  const endLine = resolveAnchorLine(lastPage, end);
  if (!startLine || !endLine) return null;

  const segments = pages.map((page) => ({
    ...page,
    lines: page.lines.filter(
      (line) =>
        (page.pageNumber !== start.page || line.index >= startLine.index) &&
        (page.pageNumber !== end.page || line.index <= endLine.index)
    ),
  }));

  const elements = screenplayElementsFromLayout(segments, {
    actionMargin: textIndex.actionMargin ?? estimateActionMargin(pages),
  });

  return {
    key: anchorPairKey(anchors),
    markdown: serializeScreenplayMarkdown(elements),
    plainText: screenplayToPlainText(elements),
    pageStart: start.page,
    pageEnd: end.page,
  };
}

/**
 * Why captureAnchoredRange returned null for these anchors: "start" or "end"
 * when that anchor is missing, "indexing" while a page in the range still
 * awaits the text index, else "unreadable". Unreadable covers a range page the
 * finished index has no text for, an anchor page with no text lines, and an
 * end anchor on an earlier page than the start; waiting won't fix those.
 */
export function captureUnavailableReason(textIndex, anchors) {
  const { start, end } = anchors || {};
  if (!start) return "start";
  if (!end) return "end";
  if (!isValidScriptLocation(anchors)) return "unreadable";
  if (!rangePages(textIndex, start, end)) return textIndex.complete ? "unreadable" : "indexing";
  return "unreadable";
}
