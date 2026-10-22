/*
 * A search started on another page (the home page's hero) hands Script Search
 * where its field sat on screen, in history state, so the search's tag can fly
 * in from it as it does from Script Search's own tile.
 */

/** History state for opening Script Search on a description searched in the field whose box is `box`. */
export function searchHandOffState(box) {
  if (!box) return undefined;
  return { searchFrom: { left: box.left, top: box.top, width: box.width, height: box.height } };
}

/** Where the field that started this search sat, if another page handed it over. */
export function getHandedOverSearchBox(locationState) {
  const box = locationState?.searchFrom;
  return box && ["left", "top", "height"].every((side) => Number.isFinite(box[side])) ? box : null;
}
