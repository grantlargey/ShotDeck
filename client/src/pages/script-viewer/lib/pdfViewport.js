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
 * Scrolls a page into the viewer. With `offsetPx` (a position inside the
 * page) that point lands a third of the way down the viewport, which keeps an
 * anchor visible with context above it; otherwise the page is centered. Falls
 * back to window scrolling on mobile, where the viewer is not independently
 * scrollable.
 */
export function scrollPageInWrap(wrap, pageElement, behavior = "auto", offsetPx = null) {
  if (!wrap || !pageElement) return;

  const isScrollable = wrap.scrollHeight > wrap.clientHeight + 2;
  if (!isScrollable) {
    const rect = pageElement.getBoundingClientRect();
    const targetTop =
      offsetPx === null
        ? window.scrollY + rect.top - 12
        : window.scrollY + rect.top + offsetPx - window.innerHeight / 3;
    window.scrollTo({ top: Math.max(0, targetTop), behavior });
    return;
  }

  const targetTop =
    offsetPx === null
      ? pageElement.offsetTop - (wrap.clientHeight / 2 - pageElement.offsetHeight / 2)
      : pageElement.offsetTop + offsetPx - wrap.clientHeight / 3;
  const maxTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
  wrap.scrollTo({ top: Math.min(maxTop, Math.max(0, targetTop)), behavior });
}

/**
 * The page under the reading line (a third of the way down the window) and
 * where it sits on screen, read before a layout change so the change can be
 * made without moving what the reader is looking at. Null while the pages
 * are off screen, as when the reader is down among the scenes.
 */
export function readReadingAnchor(wrap) {
  if (!wrap) return null;
  const box = wrap.getBoundingClientRect();
  if (box.bottom <= 0 || box.top >= window.innerHeight) return null;
  const line = window.innerHeight / 3;
  let anchor = null;
  for (const page of wrap.querySelectorAll("[data-page-number]")) {
    const pageBox = page.getBoundingClientRect();
    anchor = { page, left: pageBox.left, top: pageBox.top };
    if (pageBox.bottom > line) break;
  }
  return anchor;
}

/**
 * Scrolls `scroller` (the wrap, or the window where it scrolls the pages) to
 * put the anchor's page back where it was, and returns how far the page still
 * is from there ({ dx, dy }), as far as scrolling couldn't take it: at the top
 * of the script, the pages rise into room the change made above them.
 */
export function holdReadingAnchor(anchor, scroller) {
  if (!anchor?.page.isConnected || !scroller) return null;
  const shift = anchor.page.getBoundingClientRect().top - anchor.top;
  if (Math.abs(shift) >= 0.5) scroller.scrollBy({ top: shift, behavior: "instant" });
  const box = anchor.page.getBoundingClientRect();
  return { dx: box.left - anchor.left, dy: box.top - anchor.top };
}
