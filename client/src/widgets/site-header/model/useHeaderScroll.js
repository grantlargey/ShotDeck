import { useEffect, useState } from "react";

// Phones get the two-row header (see --sd-nav-height), which slides away on scroll.
const PHONE_QUERY = "(max-width: 780px)";
// Ignore scroll jitter smaller than this.
const MIN_SCROLL_DELTA = 6;

/**
 * How the pinned header reacts to scrolling:
 * - `scrolled`: the page has left the very top (the home page's clear header turns solid).
 * - `hidden`: on phones, the reader is scrolling down, so the header slides away;
 *   any scroll up brings it back. It never hides while it holds focus.
 *
 * While hidden it sets `data-site-header="hidden"` on <html>, which zeroes
 * --sd-header-offset so sticky page parts move up into its space.
 */
export function useHeaderScroll(headerRef, { enabled }) {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const phone = window.matchMedia?.(PHONE_QUERY);
    let lastY = window.scrollY;

    function update() {
      const y = window.scrollY;
      setScrolled(y > 8);

      const header = headerRef.current;
      const nearTop = y <= (header?.offsetHeight ?? 0);
      const holdsFocus = Boolean(header?.contains(document.activeElement));
      if (!phone?.matches || nearTop || holdsFocus) {
        setHidden(false);
      } else if (Math.abs(y - lastY) >= MIN_SCROLL_DELTA) {
        setHidden(y > lastY);
      } else {
        return;
      }
      lastY = y;
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    phone?.addEventListener("change", update);
    // Scrolling and the window's width are not the only things that decide
    // whether the header may be away: Tab moves focus on its own, and a header
    // that has already slid above the window still holds real controls - the
    // brand link, the nav links, New Project and Account. Without this a
    // keyboard reader works through those off screen until something happens to
    // scroll. focusin bubbles to the document for every focus move on the page,
    // so one listener here notices focus arriving in the header as well as
    // focus moving on elsewhere.
    document.addEventListener("focusin", update);
    return () => {
      window.removeEventListener("scroll", update);
      phone?.removeEventListener("change", update);
      document.removeEventListener("focusin", update);
    };
  }, [enabled, headerRef]);

  // A header that isn't pinned scrolls with the page and never slides.
  const isScrolled = enabled && scrolled;
  const isHidden = enabled && hidden;

  useEffect(() => {
    if (!isHidden) return undefined;
    const root = document.documentElement;
    root.dataset.siteHeader = "hidden";
    return () => {
      delete root.dataset.siteHeader;
    };
  }, [isHidden]);

  return { scrolled: isScrolled, hidden: isHidden };
}
