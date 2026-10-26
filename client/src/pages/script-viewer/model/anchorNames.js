/*
 * What the annotator calls a scene's two anchors on screen: Begin, its first
 * line, set with [, and End, its last, set with ]. The code and the API keep
 * calling them start and end, as a script location stores them.
 */
export const ANCHOR_NAMES = { start: "Begin", end: "End" };

export const ANCHOR_KEYS = { start: "[", end: "]" };

/** What the toggle for the marks drawn on the page says it will do. */
export function marksToggleLabel(visible) {
  return `${visible ? "Hide" : "Show"} the ${ANCHOR_NAMES.start} and ${ANCHOR_NAMES.end} marks`;
}
