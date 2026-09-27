import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function getMediaQuery() {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY) : null;
}

function subscribe(onChange) {
  const media = getMediaQuery();
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

/** Whether the visitor has asked their system for less motion. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, () => Boolean(getMediaQuery()?.matches), () => false);
}
