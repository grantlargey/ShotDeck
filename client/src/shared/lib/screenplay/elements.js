/**
 * Screenplay element types understood by ScriptDeck's screenplay markdown.
 *
 * Order and shortcut digits mirror Arc Studio's element menu so the editor
 * feels familiar; "centered" is an extra type for titles and "THE END".
 */
export const SCREENPLAY_ELEMENTS = [
  { type: "heading", label: "Scene Heading", shortcut: "1" },
  { type: "action", label: "Action", shortcut: "2" },
  { type: "character", label: "Character", shortcut: "3" },
  { type: "parenthetical", label: "Parenthetical", shortcut: "4" },
  { type: "dialogue", label: "Dialogue", shortcut: "5" },
  { type: "shot", label: "Shot", shortcut: "6" },
  { type: "transition", label: "Transition", shortcut: "7" },
  { type: "centered", label: "Centered", shortcut: "8" },
];

export const SCREENPLAY_ELEMENT_TYPES = SCREENPLAY_ELEMENTS.map((element) => element.type);

const ELEMENTS_BY_TYPE = new Map(SCREENPLAY_ELEMENTS.map((element) => [element.type, element]));

export function getScreenplayElement(type) {
  return ELEMENTS_BY_TYPE.get(type) || ELEMENTS_BY_TYPE.get("action");
}

export function normalizeScreenplayType(type) {
  return ELEMENTS_BY_TYPE.has(type) ? type : "action";
}

/**
 * Element created when pressing Enter at the end of a block, following
 * common screenplay-editor conventions (a cue is followed by its dialogue).
 */
export const NEXT_SCREENPLAY_TYPE = {
  heading: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "action",
  shot: "action",
  transition: "heading",
  centered: "action",
};

/**
 * Cycles through the element list, used by Tab / Shift+Tab in the editor.
 */
export function cycleScreenplayType(type, direction = 1) {
  const index = SCREENPLAY_ELEMENT_TYPES.indexOf(normalizeScreenplayType(type));
  const count = SCREENPLAY_ELEMENT_TYPES.length;
  return SCREENPLAY_ELEMENT_TYPES[(index + direction + count) % count];
}
