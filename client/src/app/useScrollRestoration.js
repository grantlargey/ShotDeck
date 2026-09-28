import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const STORAGE_KEY = "scriptdeck:scroll-positions";
// Give up re-applying a remembered position after this long.
const RESTORE_TIMEOUT_MS = 4000;
// Any of these means the reader has started scrolling on their own.
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"];

/**
 * History entries are keyed by React Router's entry key plus the URL: the
 * first page a tab loads always gets the key "default", whatever its URL.
 */
function entryId(location) {
  return `${location.key}|${location.pathname}${location.search}`;
}

/** Whether this document was loaded by a reload or by Back/Forward, rather than fresh. */
function documentWasRevisited() {
  const [navigation] = performance.getEntriesByType?.("navigation") ?? [];
  return navigation?.type === "reload" || navigation?.type === "back_forward";
}

function readPositions() {
  try {
    return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writePositions(positions) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Storage can be full or blocked; positions then last only until a reload.
  }
}

/**
 * Scrolls to `y` and keeps re-applying it while the page grows (pages fetch
 * their content after they render), until it's reached, the reader takes
 * over, or the timeout passes. Returns a function that stops early.
 */
function restoreScroll(y, onFinished) {
  const content = document.getElementById("root") ?? document.body;
  let stopped = false;
  let observer = null;
  let timer = 0;

  function stop() {
    if (stopped) return;
    stopped = true;
    onFinished();
    observer?.disconnect();
    window.clearTimeout(timer);
    for (const type of READER_INPUT) window.removeEventListener(type, stop);
  }

  function attempt() {
    if (stopped) return;
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(y, maxY));
    if (maxY >= y) stop();
  }

  attempt();
  if (stopped) return stop;

  for (const type of READER_INPUT) window.addEventListener(type, stop, { passive: true });
  timer = window.setTimeout(stop, RESTORE_TIMEOUT_MS);
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(attempt);
    observer.observe(content);
  }
  return stop;
}

/**
 * Back and Forward return to where the reader was on that page; following a
 * link to another page starts it at the top. Positions are kept per history
 * entry and survive a reload of the tab.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  // Remembered positions are written as the reader scrolls and read back on
  // Back and Forward. Nothing renders from them, so they belong in a ref: the
  // map is mutated in place, which state is not meant to be.
  const positionsRef = useRef(null);
  positionsRef.current ??= readPositions();
  const positions = positionsRef.current;
  const entryIdRef = useRef(entryId(location));
  const restoringRef = useRef(false);
  const pathnameRef = useRef(location.pathname);
  // The entry the tab opened on; its first render counts as a "POP" as well.
  const openingEntryIdRef = useRef(entryId(location));
  const leftOpeningEntryRef = useRef(false);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    // The browser restores before a page's content has loaded, and lands short.
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Remember the current entry's position as the reader scrolls, and persist
  // it when the tab is hidden or unloaded.
  useEffect(() => {
    function remember() {
      if (!restoringRef.current) positions[entryIdRef.current] = window.scrollY;
    }
    function persist() {
      if (document.visibilityState === "hidden") writePositions(positions);
    }
    function persistNow() {
      writePositions(positions);
    }
    window.addEventListener("scroll", remember, { passive: true });
    document.addEventListener("visibilitychange", persist);
    window.addEventListener("pagehide", persistNow);
    return () => {
      window.removeEventListener("scroll", remember);
      document.removeEventListener("visibilitychange", persist);
      window.removeEventListener("pagehide", persistNow);
    };
  }, [positions]);

  // Runs after the new page's DOM is in and before the browser reports the
  // resulting scroll, so the scroll it causes is filed under the new entry.
  useLayoutEffect(() => {
    restoringRef.current = false;
    const id = entryId(location);
    entryIdRef.current = id;
    const pathnameChanged = pathnameRef.current !== location.pathname;
    pathnameRef.current = location.pathname;
    if (id !== openingEntryIdRef.current) leftOpeningEntryRef.current = true;
    const opening = !leftOpeningEntryRef.current;

    // Opening the tab only returns to a spot on a reload or Back/Forward into it.
    if (navigationType === "POP" && (!opening || documentWasRevisited())) {
      // An entry never scrolled starts at the top, not wherever the last page left the window.
      restoringRef.current = true;
      return restoreScroll(positions[id] ?? 0, () => { restoringRef.current = false; });
    }
    // Filters and dialogs that only change the query string keep the reader's place.
    if (pathnameChanged) {
      window.scrollTo(0, 0);
      return undefined;
    }
    // The place the reader keeps is also the place this new entry should come
    // back to. Only the scroll listener files positions, and standing still
    // fires no scroll, so nothing would be remembered for the entry at all and
    // a later Back and then Forward would read it as the top of the page. Write
    // the inherited position down here instead. Pushing and replacing both mint
    // a fresh entry key, so both need it. A POP never does: those entries
    // restore just above, and the tab's opening render is reported as a POP as
    // well, where there is no earlier entry and so nothing to inherit.
    if (navigationType === "PUSH" || navigationType === "REPLACE") {
      positions[id] = window.scrollY;
    }
    return undefined;
  }, [location, navigationType, positions]);
}
