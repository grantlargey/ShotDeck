/** Normalizes selected tags before encoding the scene-search query. */
export function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof tags === "string") {
    return tags
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
