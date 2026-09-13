import { getScriptScenePageRange } from "./scriptSceneText.js";

/**
 * Shared sort order for script scenes: page first, timeline second, creation
 * time last. Both the viewer and search flows rely on this staying stable.
 */
export function sortScriptScenes(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const { pageStart: pageA } = getScriptScenePageRange(a);
    const { pageStart: pageB } = getScriptScenePageRange(b);
    if (pageA !== pageB) return pageA - pageB;

    const startA = Number(a.start_time_seconds || 0);
    const startB = Number(b.start_time_seconds || 0);
    if (startA !== startB) return startA - startB;

    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}
