/*
 * Reading a stored captured scene: its tags, display text, pages, order among
 * other scenes, and the script viewer link that opens it.
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

/**
 * Converts optional page_start/page_end fields into a stable inclusive range.
 */
export function getScriptScenePageRange(scene) {
  const start = Number(scene?.page_start || scene?.page_end || 1);
  const end = Number(scene?.page_end || scene?.page_start || start);
  return {
    pageStart: Number.isFinite(start) ? start : 1,
    pageEnd: Number.isFinite(end) ? end : Number.isFinite(start) ? start : 1,
  };
}

export function formatScriptScenePages(scene) {
  const { pageStart, pageEnd } = getScriptScenePageRange(scene);
  return pageEnd > pageStart ? `Pages ${pageStart}–${pageEnd}` : `Page ${pageStart}`;
}

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

/** Script viewer path that opens a scene for editing, scrolled to its first page. */
export function getSceneScriptPath(scene) {
  const params = new URLSearchParams();
  params.set("sceneId", scene.id);
  params.set("page", String(getScriptScenePageRange(scene).pageStart));
  return `/movies/${scene.movie_id}/scripts/${scene.script_id}?${params.toString()}`;
}
