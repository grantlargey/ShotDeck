/**
 * The image for a still in small spots such as grid tiles and previews: its
 * thumbnail once the API has made one, otherwise the full image.
 */
export function getStillThumbnail(still) {
  if (still?.thumb_key) return { key: still.thumb_key, url: still.thumb_url || null };
  return { key: still?.image_key || null, url: still?.image_url || null };
}
