import {
  safeScriptSceneTags,
  sortScriptScenes,
} from "@/entities/script-scene/model/capturedScene.js";
import {
  SCRIPT_TAG_CATEGORIES,
  SCRIPT_TAG_LABELS,
} from "@server/domain/script-tags.js";

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

/**
 * Sidebar groups: the known tag taxonomy plus an "Other" group for saved tags
 * outside it, so older free-form tags stay filterable.
 */
export function buildFilterGroups(catalog, selectedTags) {
  const otherTags = new Set();
  for (const scene of catalog) {
    for (const tag of safeScriptSceneTags(scene.tags)) {
      if (!SCRIPT_TAG_LABELS[tag]) otherTags.add(tag);
    }
  }
  for (const tag of selectedTags) {
    if (!SCRIPT_TAG_LABELS[tag]) otherTags.add(tag);
  }

  if (otherTags.size === 0) return SCRIPT_TAG_CATEGORIES;

  return [
    ...SCRIPT_TAG_CATEGORIES,
    {
      key: "other",
      label: "Other Tags",
      tags: [...otherTags]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    },
  ];
}
