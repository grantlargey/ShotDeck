const CHARACTER_NORMALIZATION = [
  [/[\u2018\u2019\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201F\u2033]/g, '"'],
  [/\u2026/g, "..."],
  [/[\u00A0\u2007\u202F]/g, " "],
];

function tokenizeWords(text) {
  let normalized = String(text ?? "");
  for (const [pattern, replacement] of CHARACTER_NORMALIZATION) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.split(/\s+/).filter(Boolean);
}

function countWords(words) {
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return counts;
}

function subtractCounts(left, right) {
  const result = [];
  for (const [word, count] of left) {
    const difference = count - (right.get(word) || 0);
    if (difference > 0) result.push({ word, count: difference });
  }
  return result;
}

/**
 * Compares the words of a candidate transcript against the captured PDF text,
 * ignoring whitespace and quote style. Order is not checked: the goal is to
 * catch dropped, invented, or re-spelled words from formatting or editing.
 */
export function compareWordFidelity(baselineText, candidateText) {
  const baselineWords = tokenizeWords(baselineText);
  const candidateWords = tokenizeWords(candidateText);
  const baselineCounts = countWords(baselineWords);
  const candidateCounts = countWords(candidateWords);

  const missing = subtractCounts(baselineCounts, candidateCounts);
  const added = subtractCounts(candidateCounts, baselineCounts);
  const missingCount = missing.reduce((sum, entry) => sum + entry.count, 0);
  const addedCount = added.reduce((sum, entry) => sum + entry.count, 0);

  return {
    baselineCount: baselineWords.length,
    candidateCount: candidateWords.length,
    missing,
    added,
    missingCount,
    addedCount,
    exact: missingCount === 0 && addedCount === 0,
  };
}
