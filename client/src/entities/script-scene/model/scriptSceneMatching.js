import { getScriptScenePageRange } from "./scriptSceneText.js";

export function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

/**
 * Finds whether a new PDF text selection likely points at an existing saved
 * scene. This prevents duplicate scene annotations when users reselect the
 * same script range.
 */
export function findOverlappingScriptScene(scenes, selection) {
  const selectedNorm = normalizeComparableText(selection?.raw_selected_text);
  if (!selectedNorm) return null;

  let best = null;
  let bestScore = -1;
  const { pageStart: selectionPageStart, pageEnd: selectionPageEnd } =
    getScriptScenePageRange(selection);

  for (const scene of Array.isArray(scenes) ? scenes : []) {
    const sceneNorm = normalizeComparableText(scene.raw_selected_text || scene.selected_text || "");
    if (!sceneNorm) continue;

    const { pageStart: scenePageStart, pageEnd: scenePageEnd } = getScriptScenePageRange(scene);
    const pageOverlap = rangesOverlap(
      selectionPageStart,
      selectionPageEnd,
      scenePageStart,
      scenePageEnd
    );
    const exactText = selectedNorm === sceneNorm;
    const partialText = selectedNorm.includes(sceneNorm) || sceneNorm.includes(selectedNorm);

    let score = 0;
    if (pageOverlap) score += 2;
    if (exactText) score += 4;
    else if (partialText) score += 2;

    if (score > bestScore) {
      best = scene;
      bestScore = score;
    }
  }

  return bestScore >= 4 ? best : null;
}
