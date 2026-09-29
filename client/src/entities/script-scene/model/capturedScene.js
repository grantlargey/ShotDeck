import { momentSeconds } from "./filmTiming.js";
import { scenePageRange } from "./scriptLocation.js";

/* Reading a stored captured scene: tags, text, order and script-viewer link. */

/** Normalizes tag values from the API before UI code renders chips or filters. */
export function safeScriptSceneTags(tags) {
  return Array.isArray(tags) ? tags.map(String) : [];
}

/** The canonical scene text stored for a captured scene. */
export function displayScriptSceneText(item) {
  return typeof item?.scene_text === "string" ? item.scene_text : "";
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePageOrder(a, b) {
  return (
    a.script_location.start.page - b.script_location.start.page ||
    a.script_location.start.y - b.script_location.start.y ||
    compareText(a.id, b.id)
  );
}

/** Captured scenes in the server's order: start page, start baseline, then id. */
export function sortScriptScenes(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort(comparePageOrder);
}

/**
 * Captured scenes in film order: by the start of their film timing, which a
 * script's scenes need not follow on the page. Scenes with no timing yet have
 * no place in the film, so they follow the timed ones in page order.
 */
export function sortScriptScenesByTime(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const left = momentSeconds(a.start_time_seconds);
    const right = momentSeconds(b.start_time_seconds);
    if (left === null || right === null) {
      return left === right ? comparePageOrder(a, b) : left === null ? 1 : -1;
    }
    return left - right || comparePageOrder(a, b);
  });
}

/** Script viewer path that opens and scrolls to a captured scene. */
export function getSceneScriptPath(scene) {
  const params = new URLSearchParams();
  params.set("sceneId", scene.id);
  const range = scenePageRange(scene);
  if (range) params.set("page", String(range.pageStart));
  return `/movies/${scene.movie_id}/scripts/${scene.script_id}?${params.toString()}`;
}
