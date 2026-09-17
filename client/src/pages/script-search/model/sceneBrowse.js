import {
  safeScriptSceneTags,
  sortScriptScenes,
} from "@/entities/script-scene/model/capturedScene.js";
import { SCRIPT_TAG_CATEGORIES } from "@server/domain/script-tags.js";

export const SCENE_SORT_OPTIONS = [
  { value: "recent", label: "Recently updated" },
  { value: "title", label: "Title & page" },
];

/**
 * The API already returns scenes newest-first; "title" regroups them by movie
 * while keeping script page order inside each title.
 */
export function sortScenes(scenes, sortKey) {
  if (sortKey !== "title") return scenes;
  return sortScriptScenes(scenes).sort((a, b) =>
    String(a.movie_title || "").localeCompare(String(b.movie_title || ""))
  );
}

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
