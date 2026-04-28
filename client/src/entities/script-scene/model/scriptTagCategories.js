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
