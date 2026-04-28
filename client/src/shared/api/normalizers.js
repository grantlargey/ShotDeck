/**
 * Normalizers keep request payload conventions consistent with the backend.
 */
export function normalizeLinks(links) {
  if (Array.isArray(links)) return links.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof links === "string") {
    return links
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

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
