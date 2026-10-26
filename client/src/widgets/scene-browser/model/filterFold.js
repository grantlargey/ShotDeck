import { useSyncExternalStore } from "react";

/*
 * The scene filters folded away: on wide screens the filter panel can swing
 * shut onto a spine beside the scene grid. Script Search and the script viewer
 * share the choice, and this browser remembers it. Narrow screens keep the
 * filters in a drawer instead.
 */

const STORAGE_KEY = "scriptdeck:scene-filters-folded";

// How long the panel takes to swing shut or open again (SceneBrowser.module.css,
// swing-shut and swing-open). The cards glide to their new places in step.
export const FOLD_MS = 560;
export const GLIDE_EASING = "cubic-bezier(0.4, 0.1, 0.2, 1)";
// A card that moves further up or down than this has wrapped onto another row.
const WRAP_PX = 8;

const listeners = new Set();
let folded = readSaved();

function readSaved() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Storage is blocked: the filters start shown.
    return false;
  }
}

/** Folds the filters away, or brings them back, everywhere they show, and remembers it for this browser. */
export function setFiltersFolded(next) {
  folded = Boolean(next);
  try {
    if (folded) window.localStorage.setItem(STORAGE_KEY, "true");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is blocked: the choice lasts until the page closes.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the filters are folded away, and its setter. */
export function useFiltersFolded() {
  const value = useSyncExternalStore(subscribe, () => folded, () => false);
  return [value, setFiltersFolded];
}

/**
 * The keyframes that carry an element from where it was (`from`) to where it
 * sits now (`to`), both screen boxes; null when it hasn't moved. A card that
 * wraps onto another row dims as it crosses the grid, so the crossing reads as
 * a shuffle.
 */
export function glideKeyframes(from, to) {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  const start = `translate(${dx}px, ${dy}px)`;
  if (Math.abs(dy) > WRAP_PX) {
    return [{ transform: start, opacity: 1 }, { opacity: 0.35, offset: 0.45 }, { transform: "none", opacity: 1 }];
  }
  return [{ transform: start }, { transform: "none" }];
}
