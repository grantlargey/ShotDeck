/**
 * What to do with a deep link's pending scroll.
 *
 * A deep link's scroll is an intent that outlives the render that made it: it
 * waits for the background indexer to publish the page its script location sits
 * on, which can be many seconds after the link opened. Three things can end
 * that wait, and until one of them does the intent stays armed.
 *
 * The order the cases are tested in is the rule, not an accident. Someone who
 * has already moved on doesn't need to be told that the link they left behind
 * couldn't be followed either, so "superseded" is read before "unreachable".
 */

/**
 * The intent is `{ page, offsetPt, location?, sceneId? }`, or null when nothing
 * is waiting. Returns one of:
 *
 * - `"drop"` — the scene the intent was made for is no longer the scene in
 *   hand, so end the wait silently. Hanging this off the active scene rather
 *   than off each navigation handler is what stops a handler forgetting to
 *   cancel: "New scene" changes the draft without scrolling, so no scroll of
 *   its own would have covered it.
 * - `"abandon"` — the page is never coming. A scan carries no extractable text,
 *   and a location can name a page past the end of the document; once indexing
 *   is complete no later publish will add one. The link promised to land on a
 *   scene, so giving up has to be said out loud.
 * - `"run"` — the page is there; scroll to it.
 * - `"wait"` — nothing to do yet.
 */
export function nextScrollAction(intent, { numPages, indexedPages, indexComplete, activeSceneId }) {
  if (!intent) return "wait";
  if (intent.sceneId && intent.sceneId !== activeSceneId) return "drop";
  if (intent.location && indexComplete && !indexedPages.has(intent.page)) return "abandon";

  const pageIsReady = !intent.location || indexedPages.has(intent.page);
  return numPages > 0 && pageIsReady ? "run" : "wait";
}
