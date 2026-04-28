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
