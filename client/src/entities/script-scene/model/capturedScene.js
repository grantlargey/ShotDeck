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

/** Captured scenes in the server's order: start page, start line, then id. */
export function sortScriptScenes(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort(
    (a, b) =>
      a.script_location.start.page - b.script_location.start.page ||
      a.script_location.start.line - b.script_location.start.line ||
      compareText(a.id, b.id)
  );
}

/** Script viewer path that opens and scrolls to a captured scene. */
export function getSceneScriptPath(scene) {
  const params = new URLSearchParams();
  params.set("sceneId", scene.id);
  const range = scenePageRange(scene);
  if (range) params.set("page", String(range.pageStart));
  return `/movies/${scene.movie_id}/scripts/${scene.script_id}?${params.toString()}`;
}
