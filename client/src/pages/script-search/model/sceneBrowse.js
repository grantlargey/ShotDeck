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
