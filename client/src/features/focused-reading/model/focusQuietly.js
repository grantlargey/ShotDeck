/**
 * Hands keyboard focus to a reading surface (the scene's paper, the script's
 * pages) so the keys scroll it, without drawing its focus ring: going into
 * focused reading hands the keys over; the reader didn't move to it. While
 * `data-quiet-focus` is set the surface's styles leave the ring off, and it
 * goes with the first blur, so tabbing back shows the ring as usual.
 */
export function focusQuietly(element) {
  if (!element || element === document.activeElement) return;
  element.dataset.quietFocus = "";
  element.addEventListener(
    "blur",
    () => {
      delete element.dataset.quietFocus;
    },
    { once: true }
  );
  element.focus({ preventScroll: true });
}
