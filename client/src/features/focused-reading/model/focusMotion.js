/*
 * Focused reading's motion in script: the glides that carry things across a
 * layout change, read before it and played once it's laid out. The CSS side is
 * the --focus-* tokens in tokens.css; keep these in step with them.
 */

// The focus key glides to its corner a beat after the chrome starts to blur
// out (--focus-layout-in, --focus-layout-delay), and straight back on leaving
// (--focus-layout-out), easing in and out like a hand moving it.
export const KEY_GLIDE = {
  in: { duration: 460, delay: 140, easing: "cubic-bezier(0.65, 0, 0.25, 1)" },
  out: { duration: 400, delay: 0, easing: "cubic-bezier(0.65, 0, 0.25, 1)" },
};

// The text settles into the room the chrome leaves (--focus-layout-*, --focus-ease).
export const TEXT_GLIDE = {
  in: { duration: 460, delay: 140, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
  out: { duration: 400, delay: 0, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
};

// The room darkening over what it covers (--focus-room-in).
export const ROOM_FADE = { duration: 420, easing: "ease" };

/** Where an element is on screen now, or null without one. */
export function readBox(element) {
  return element?.getBoundingClientRect() ?? null;
}

/**
 * Starts an element (dx, dy) away from where it now sits and glides it home.
 * The offset holds through the delay. Null when it hasn't moved, or where
 * elements can't animate.
 */
export function glideBy(element, dx, dy, { duration, delay = 0, easing }) {
  if (!element || typeof element.animate !== "function") return null;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
    duration,
    delay,
    easing,
    fill: "backwards",
  });
}

/** Glides an element from `from`, its box read before a layout change, to where the change put it. */
export function glideFrom(element, from, options) {
  const to = readBox(element);
  if (!from || !to) return null;
  return glideBy(element, from.left - to.left, from.top - to.top, options);
}
