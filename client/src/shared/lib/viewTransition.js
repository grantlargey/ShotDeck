const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const POLL_MS = 16;

/** Whether the browser can animate a page change and the visitor hasn't asked for less motion. */
export function canAnimatePageChange() {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !window.matchMedia?.(REDUCED_MOTION_QUERY).matches
  );
}

/** Resolves once `isReady()` is true, or after `timeoutMs` either way. */
function waitUntil(isReady, timeoutMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    (function check() {
      if (isReady() || performance.now() - start >= timeoutMs) resolve();
      else window.setTimeout(check, POLL_MS);
    })();
  });
}

/**
 * Navigates (with optional history `state`) inside a view transition. The
 * browser holds the old page on screen until `isReady()` says the new one has
 * what the transition animates to, for at most `timeoutMs`, then animates
 * between them.
 */
export function navigateWithTransition(navigate, to, { state, isReady = () => true, timeoutMs = 400, onCaptured } = {}) {
  return document.startViewTransition(async () => {
    onCaptured?.();
    navigate(to, { state });
    await waitUntil(isReady, timeoutMs);
  });
}
