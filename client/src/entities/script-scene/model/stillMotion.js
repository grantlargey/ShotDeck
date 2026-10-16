/*
 * A scene card's film still, played in or away as Script Search turns its
 * cards between script only and still and script. Going in, every card's frame
 * opens at once, then each still arrives as its own negative and turns
 * positive. Going away, each still turns back into a negative and fades, then
 * the frames close together. A card's `delay` holds its still back from the
 * others, so the stills can sweep across a grid.
 *
 * The timings match SceneCard.module.css.
 */
const STILL_MOTION_MS = { revealAt: 120, reveal: 1060, hide: 600, close: 320 };

/**
 * The motion for a grid of cards, given each card's delay: when the frames
 * close (once the last still has gone) and how long it all takes.
 */
export function planStillMotion(phase, delays) {
  const last = delays.length ? Math.max(...delays) : 0;
  if (phase === "in") {
    return { phase, delays, frameDelay: 0, duration: STILL_MOTION_MS.revealAt + last + STILL_MOTION_MS.reveal };
  }
  const frameDelay = last + STILL_MOTION_MS.hide;
  return { phase, delays, frameDelay, duration: frameDelay + STILL_MOTION_MS.close };
}
