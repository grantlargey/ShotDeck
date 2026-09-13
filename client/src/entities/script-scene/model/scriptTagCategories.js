function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\w\s/-]+/g, "")
    .replace(/\//g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createTag(groupKey, label) {
  return {
    value: `${groupKey}:${slugify(label)}`,
    label,
  };
}

function createGroup(key, label, tags) {
  return {
    key,
    label,
    tags: tags.map((tag) => createTag(key, tag)),
  };
}

export const SCRIPT_TAG_CATEGORIES = [
  createGroup("character-focus", "Character Focus", [
    "Protagonist",
    "Antagonist",
    "Supporting Character",
    "Ensemble",
    "Mentor",
    "Love Interest",
  ]),
  createGroup("conflict-type", "Conflict Type", [
    "Character vs Self",
    "Character vs Character",
    "Character vs Society",
    "Character vs Nature",
    "Character vs System",
    "Character vs Fate / Unknown",
    "Minimal / No Overt Conflict",
  ]),
  createGroup("narrative-function", "Narrative Function", [
    "Character Introduction",
    "World Introduction",
    "Tone Establishment",
    "Theme Establishment",
    "Inciting Incident",
    "Goal Establishment",
    "Obstacle",
    "Revelation",
    "Relationship Development",
    "Turning Point",
    "Escalation",
    "Climax",
    "Aftermath",
    "Resolution",
  ]),
  createGroup("structural-position", "Structural Position", [
    "Introduction",
    "Setup",
    "Catalyst",
    "Debate",
    "Midpoint",
    "Crisis",
    "Climax",
    "Denouement",
  ]),
  createGroup("dialogue-mode", "Dialogue Mode", [
    "None",
    "Silent Visual Storytelling",
    "Minimal Dialogue",
    "Conversational",
    "Expository",
    "Confrontational",
    "Monologue",
    "Voiceover",
  ]),
  createGroup("tone", "Tone", [
    "Tension",
    "Isolation",
    "Determination",
    "Dread",
    "Awe",
    "Intimacy",
    "Chaos",
    "Suspense",
    "Tragedy",
    "Melancholy",
    "Wonder",
  ]),
  createGroup("stakes", "Stakes", [
    "Physical",
    "Emotional",
    "Social",
    "Moral",
    "Financial",
    "Existential",
    "Low Stakes",
  ]),
  createGroup("expository-value", "Expository Value", [
    "Character Capability",
    "Character Weakness",
    "Character Obsession",
    "World Rules",
    "Goal Information",
    "Backstory",
    "Thematic Premise",
    "No Major New Information",
  ]),
];

export const SCRIPT_TAGS = SCRIPT_TAG_CATEGORIES.flatMap((group) =>
  group.tags.map((tag) => tag.value)
);

export const SCRIPT_TAG_LABELS = Object.fromEntries(
  SCRIPT_TAG_CATEGORIES.flatMap((group) => group.tags.map((tag) => [tag.value, tag.label]))
);

export function getScriptTagLabel(tagValue) {
  return SCRIPT_TAG_LABELS[tagValue] || tagValue;
}

const TAG_CATEGORY_INDEX = new Map(
  SCRIPT_TAG_CATEGORIES.flatMap((group, index) => group.tags.map((tag) => [tag.value, index]))
);

/**
 * Groups a scene's tags under their taxonomy category labels, in taxonomy
 * order, with unknown tags collected under "Other".
 */
export function groupScriptTagsByCategory(tags) {
  const groups = new Map();
  for (const tag of Array.isArray(tags) ? tags.map(String) : []) {
    const index = TAG_CATEGORY_INDEX.get(tag) ?? SCRIPT_TAG_CATEGORIES.length;
    if (!groups.has(index)) {
      groups.set(index, { label: SCRIPT_TAG_CATEGORIES[index]?.label || "Other", values: [] });
    }
    groups.get(index).values.push(getScriptTagLabel(tag));
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}
