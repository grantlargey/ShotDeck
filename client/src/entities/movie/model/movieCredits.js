/**
 * Crew credits stored as free text on a movie. Director is required; the rest
 * are optional. Forms, filters, sorting, and the project header all read this
 * list so every credit behaves the same way.
 */
export const MOVIE_CREDITS = [
  { field: "director", label: "Director", plural: "directors", required: true },
  { field: "cinematographer", label: "Cinematographer", plural: "cinematographers", required: false },
  { field: "writer", label: "Writer", plural: "writers", required: false },
];

// Separators between people in one credit, e.g. "Todd Phillips & Scott Silver".
const CREDIT_NAME_SEPARATOR = /\s*(?:&|,|\band\b)\s*/i;

/** Splits a free-text credit into the individual names it lists. */
export function splitCreditNames(value) {
  return String(value || "")
    .split(CREDIT_NAME_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean);
}
