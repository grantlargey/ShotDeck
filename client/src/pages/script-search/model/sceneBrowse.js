import {
  displayScriptSceneText,
  getScriptScenePageRange,
  getScriptTagLabel,
  safeScriptSceneTags,
  SCRIPT_TAG_CATEGORIES,
  SCRIPT_TAG_LABELS,
  sortScriptScenes,
} from "@/entities/script-scene";

const SCENE_HEADING_PATTERN = /^(INT|EXT|EST|I\/E)[.\s/]/i;
const MAX_HEADING_LENGTH = 80;
const PREVIEW_CHAR_LIMIT = 520;

const TAG_CATEGORY_INDEX = new Map(
  SCRIPT_TAG_CATEGORIES.flatMap((group, index) => group.tags.map((tag) => [tag.value, index]))
);

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

export function groupTagsByCategory(tags) {
  const groups = new Map();
  for (const tag of safeScriptSceneTags(tags)) {
    const index = TAG_CATEGORY_INDEX.get(tag) ?? SCRIPT_TAG_CATEGORIES.length;
    if (!groups.has(index)) {
      groups.set(index, { label: SCRIPT_TAG_CATEGORIES[index]?.label || "Other", values: [] });
    }
    groups.get(index).values.push(getScriptTagLabel(tag));
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}

export function formatScenePages(scene) {
  const { pageStart, pageEnd } = getScriptScenePageRange(scene);
  return pageEnd > pageStart ? `Pages ${pageStart}–${pageEnd}` : `Page ${pageStart}`;
}

function isAllCaps(line) {
  return /[A-Z]/.test(line) && line === line.toUpperCase();
}

/**
 * Saved scene text is hard-wrapped to the PDF's line width, which re-wraps
 * raggedly in a narrow card. Rejoin wrapped prose, but keep all-caps lines
 * (headings, character cues, transitions) on their own line.
 */
export function buildScenePreview(scene) {
  const lines = displayScriptSceneText(scene)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Raw PDF selections can arrive as one long line, so only a short first line
  // counts as a scene heading.
  const heading =
    lines.length > 0 &&
    lines[0].length <= MAX_HEADING_LENGTH &&
    SCENE_HEADING_PATTERN.test(lines[0])
      ? lines.shift()
      : "";

  const blocks = [];
  for (const line of lines) {
    const standalone = isAllCaps(line);
    const previous = blocks[blocks.length - 1];
    if (previous && !standalone && !previous.standalone) previous.text += ` ${line}`;
    else blocks.push({ text: line, standalone });
  }

  let excerpt = "";
  for (const block of blocks) {
    const remaining = PREVIEW_CHAR_LIMIT - excerpt.length;
    if (remaining <= 0) break;
    const text =
      block.text.length > remaining
        ? `${block.text.slice(0, remaining).replace(/\s+\S*$/, "")}…`
        : block.text;
    excerpt += `${excerpt ? "\n" : ""}${text}`;
  }

  return { heading, excerpt };
}
