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

/*
 * Captured text: the text between a scene draft's anchors, read from the script
 * and laid out as screenplay text.
 *
 * Capturing that text and explaining why it can't be captured are one walk of
 * the range, because the walk learns the reason on its way: an anchor that
 * isn't placed, a page the text index hasn't published, a baseline with no line
 * under it, a range that holds nothing but page furniture. Deriving the reason
 * a second time would re-read up to three hundred pages to say what the walk
 * already knew, and would let the annotator and a save attempt describe the
 * same anchors differently.
 */

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

function unavailable(reason) {
  return { capture: null, unavailable: reason };
}

/**
 * The captured text between two scene anchors, or the one reason there is none:
 * `{ capture, unavailable }`, with exactly one of the two set.
 *
 * A capture carries `{ key, markdown, plainText, pageStart, pageEnd }` and is
 * keyed by its anchor pair, so text kept from an earlier pair can be told apart
 * from text this range would capture now.
 *
 * `unavailable` is one of:
 * - "start" / "end": that scene anchor isn't placed yet.
 * - "indexing": a page in the range still awaits the text index, so these same
 *   anchors may capture in a moment.
 * - "unreadable": waiting won't help. The finished index has no text for a page
 *   in the range (a scan), an anchor's baseline has no line under it, the pair
 *   is outside what the script location contract accepts, or every line in the
 *   range is an artifact the layout strips.
 *
 * The layout reads the range against the action margin in effect, which is the
 * document's own once the index has estimated one and the range's pages until
 * then. The same anchors can therefore capture differently as more of the
 * script is indexed, and callers that key an editor on the text must expect it.
 */
export function captureAnchoredRange(textIndex, anchors) {
  const { start, end } = anchors || {};
  if (!start) return unavailable("start");
  if (!end) return unavailable("end");
  if (!isValidScriptLocation(anchors)) return unavailable("unreadable");

  const pages = rangePages(textIndex, start, end);
  if (!pages) return unavailable(textIndex.complete ? "unreadable" : "indexing");

  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const startLine = resolveAnchorLine(firstPage, start);
  const endLine = resolveAnchorLine(lastPage, end);
  if (!startLine || !endLine) return unavailable("unreadable");

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
  const plainText = screenplayToPlainText(elements);
  // A range can hold indexed lines and still capture nothing: a page number on
  // an otherwise blank page is stripped as an artifact. There is no scene text
  // to save, and no amount of indexing will produce any.
  if (!plainText.trim()) return unavailable("unreadable");

  return {
    capture: {
      key: anchorPairKey(anchors),
      markdown: serializeScreenplayMarkdown(elements),
      plainText,
      pageStart: start.page,
      pageEnd: end.page,
    },
    unavailable: null,
  };
}
