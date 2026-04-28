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

/**
 * Groups saved scenes by every PDF page they cover so page overlays can render
 * without rebuilding this map inside the page component.
 */
export function groupScriptScenesByPage(scenes) {
  const pageMap = new Map();
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    const { pageStart, pageEnd } = getScriptScenePageRange(scene);
    const from = Math.max(1, Math.min(pageStart, pageEnd));
    const to = Math.max(from, Math.max(pageStart, pageEnd));

    for (let page = from; page <= to; page += 1) {
      if (!pageMap.has(page)) pageMap.set(page, []);
      pageMap.get(page).push(scene);
    }
  }

  for (const [page, rows] of pageMap.entries()) {
    pageMap.set(page, sortScriptScenes(rows));
  }

  return pageMap;
}
