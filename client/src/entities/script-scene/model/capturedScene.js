import { scenePageRange } from "./scriptLocation.js";

/*
 * Reading a stored captured scene: its tags, display text, order among other
 * scenes, and the script viewer link that opens it. Where it sits in its
 * script is read in scriptLocation.js.
 */

/**
 * Normalizes tag values from the API before UI code renders chips or filters.
 */
export function safeScriptSceneTags(tags) {
  return Array.isArray(tags) ? tags.map(String) : [];
}

/**
 * Shows the best available human-readable scene text while preserving the raw
 * selection as a fallback.
 */
export function displayScriptSceneText(item) {
  if (typeof item?.formatted_selected_text === "string" && item.formatted_selected_text.trim()) {
    return item.formatted_selected_text;
  }
  if (typeof item?.raw_selected_text === "string" && item.raw_selected_text.trim()) {
    return item.raw_selected_text;
  }
  return item?.selected_text || "";
}

function storedNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Ascending, with missing values last, as Postgres sorts `ASC`. */
function compareNullsLast(left, right) {
  if (left === null || right === null) return (left === null) - (right === null);
  return left - right;
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Captured scenes in the order the API lists a script's scenes: first page
 * (unknown pages last), then film timing start, then creation time. Rows the
 * order can't separate keep their given order. Both the viewer and search
 * flows rely on this staying stable.
 */
export function sortScriptScenes(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort(
    (a, b) =>
      compareNullsLast(scenePageRange(a)?.pageStart ?? null, scenePageRange(b)?.pageStart ?? null) ||
      compareNullsLast(storedNumber(a.start_time_seconds), storedNumber(b.start_time_seconds)) ||
      compareText(a.created_at, b.created_at)
  );
}

/**
 * Script viewer path that opens a scene. It names the scene's first page when
 * that's known, so the viewer can scroll before its scenes load; either way the
 * viewer scrolls to the scene once they have.
 */
export function getSceneScriptPath(scene) {
  const params = new URLSearchParams();
  params.set("sceneId", scene.id);
  const range = scenePageRange(scene);
  if (range) params.set("page", String(range.pageStart));
  return `/movies/${scene.movie_id}/scripts/${scene.script_id}?${params.toString()}`;
}
