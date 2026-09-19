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
