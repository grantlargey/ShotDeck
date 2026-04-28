/**
 * Walks up from a text node to the nearest rendered PDF page wrapper.
 */
export function pageFromNode(node) {
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

/**
 * React-PDF can create a page container before its canvas has useful size.
 * Scroll/deep-link behavior waits for this check so jumps land on real content.
 */
export function isPageRendered(pageElement) {
  if (!pageElement) return false;

  const canvas = pageElement.querySelector("canvas");
  if (canvas && canvas.clientHeight > 0 && canvas.clientWidth > 0) return true;

  return pageElement.getBoundingClientRect().height > 160;
}

/**
 * Centers a PDF page inside the scrollable viewer when possible, with a window
 * scroll fallback for mobile layouts where the viewer is not independently
 * scrollable.
 */
export function scrollPageInWrap(wrap, pageElement, behavior = "auto") {
  if (!wrap || !pageElement) return;

  const isScrollable = wrap.scrollHeight > wrap.clientHeight + 2;
  if (!isScrollable) {
    const rect = pageElement.getBoundingClientRect();
    const targetTop = window.scrollY + rect.top - 12;
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
    return;
  }

  const targetTop = pageElement.offsetTop - (wrap.clientHeight / 2 - pageElement.offsetHeight / 2);
  const maxTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
  const clampedTop = Math.min(maxTop, Math.max(0, targetTop));

  wrap.scrollTo({
    top: clampedTop,
    behavior,
  });
}

function nodeIsInsideRoot(node, root) {
  if (!node || !root) return false;

  let current = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode || current.host || null;
  }

  return false;
}

/**
 * Guards text-selection handling so selecting text elsewhere on the page does
 * not accidentally create a scene annotation.
 */
export function selectionBelongsToRoot(selection, root) {
  if (!selection || selection.rangeCount < 1) return false;
  return nodeIsInsideRoot(selection.anchorNode, root) || nodeIsInsideRoot(selection.focusNode, root);
}

/**
 * Captures enough nearby text and geometry to reconnect a saved scene to its
 * location in the PDF later.
 */
export function extractSelectionContext(selection) {
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
