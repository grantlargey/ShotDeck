export const SCRIPT_TAG_CATEGORIES = [
  {
    key: "shot-type",
    label: "Shot Type",
    tags: ["Wide", "Medium", "Close-Up", "Extreme Close-Up", "Insert", "POV"],
  },
  {
    key: "camera",
    label: "Camera",
    tags: ["Static", "Handheld", "Dolly", "Crane", "Steadicam", "Zoom"],
  },
  {
    key: "lighting",
    label: "Lighting",
    tags: ["High Key", "Low Key", "Natural", "Silhouette", "Practicals"],
  },
  {
    key: "tone",
    label: "Tone",
    tags: ["Tension", "Romance", "Action", "Comedy", "Horror", "Melancholy"],
  },
  {
    key: "setting",
    label: "Setting",
    tags: ["Interior", "Exterior", "Night", "Day", "Urban", "Nature"],
  },
];

export const SCRIPT_TAGS = SCRIPT_TAG_CATEGORIES.flatMap((group) => group.tags);
