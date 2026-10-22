import { useSyncExternalStore } from "react";

/*
 * Scene text style: how the site sets captured scenes' screenplay text. A
 * visitor picks one, this browser remembers it, and it is applied as
 * `data-scene-text-style` on <html>, where tokens.css gives each style its
 * paper, ink and type. Everything that shows scene text follows it.
 */

// In the order every control offers them: white, cream, then blue. Labels are
// for screen readers only; the controls show each style by example.
export const SCENE_TEXT_STYLES = [
  { value: "reading", label: "Reading Edition" },
  { value: "cream", label: "Cream Paper" },
  { value: "midnight", label: "Midnight Edition" },
];

const DEFAULT_STYLE = "midnight";
const STORAGE_KEY = "scriptdeck:scene-text-style";

const listeners = new Set();

function isStyle(value) {
  return SCENE_TEXT_STYLES.some((style) => style.value === value);
}

function show(style) {
  document.documentElement.dataset.sceneTextStyle = style;
}

/** The style on the page now. */
export function getSceneTextStyle() {
  const style = document.documentElement.dataset.sceneTextStyle;
  return isStyle(style) ? style : DEFAULT_STYLE;
}

/** Shows the style this browser saved, or the default. Run before the first render so the page never flashes another style. */
export function showSavedSceneTextStyle() {
  let saved = null;
  try {
    saved = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage is blocked: the default shows, and a pick lasts until the page closes.
  }
  show(isStyle(saved) ? saved : DEFAULT_STYLE);
}

/** The style after `style`, wrapping from the last back to the first. */
export function nextSceneTextStyle(style) {
  const index = SCENE_TEXT_STYLES.findIndex((option) => option.value === style);
  return SCENE_TEXT_STYLES[(index + 1) % SCENE_TEXT_STYLES.length].value;
}

/** The screen reader name of `style`. */
export function sceneTextStyleLabel(style) {
  return SCENE_TEXT_STYLES.find((option) => option.value === style)?.label ?? "";
}

/** Shows `style` everywhere and remembers it for this browser. */
export function setSceneTextStyle(style) {
  if (!isStyle(style)) return;
  show(style);
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Storage is blocked: the pick lasts until the page closes.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current scene text style and its setter. */
export function useSceneTextStyle() {
  const style = useSyncExternalStore(subscribe, getSceneTextStyle, () => DEFAULT_STYLE);
  return [style, setSceneTextStyle];
}
