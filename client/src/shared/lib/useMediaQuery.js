import { useCallback, useSyncExternalStore } from "react";

function getMediaQuery(query) {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null;
}

/** Whether a media query matches now, following changes; false where there are no media queries. */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const media = getMediaQuery(query);
      media?.addEventListener("change", onChange);
      return () => media?.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => Boolean(getMediaQuery(query)?.matches), () => false);
}
