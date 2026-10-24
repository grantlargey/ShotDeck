import { safeScriptSceneTags } from "@/entities/script-scene/model/capturedScene.js";
import { SCRIPT_TAG_CATEGORIES } from "@server/domain/script-tags.js";

export function countSceneTags(scenes) {
  const counts = new Map();
  for (const scene of scenes) {
    for (const tag of new Set(safeScriptSceneTags(scene.tags))) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

/** Sidebar groups are exactly the write-time taxonomy. */
export function buildFilterGroups() {
  return SCRIPT_TAG_CATEGORIES;
}

/** Tag browsing over the viewer's live collection, preserving script order. */
export function filterSceneTags(scenes, selectedTags, match) {
  if (selectedTags.length === 0) return scenes;
  return scenes.filter((scene) => {
    const tags = safeScriptSceneTags(scene.tags);
    return match === "any"
      ? selectedTags.some((tag) => tags.includes(tag))
      : selectedTags.every((tag) => tags.includes(tag));
  });
}
