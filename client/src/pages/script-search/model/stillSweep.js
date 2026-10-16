// The stills sweep across the grid at this pace, left to right going in and
// right to left going away...
const SWEEP_MS_PER_PX = 0.5;
// ...though even a very wide grid takes no longer than this to cross.
const MAX_SWEEP_MS = 600;

/**
 * Each card's delay in the sweep, from its left and right edges on screen
 * (`edges`, in grid order), so the cards in one column move together.
 * phase: "in" | "out"
 */
export function sweepDelays(phase, edges) {
  if (edges.length === 0) return [];
  const lefts = edges.map((edge) => edge.left);
  const first = Math.min(...lefts);
  const last = Math.max(...edges.map((edge) => edge.right));
  const span = Math.max(...lefts) - first;
  const pace = span > 0 ? Math.min(SWEEP_MS_PER_PX, MAX_SWEEP_MS / span) : 0;
  return edges.map((edge) => Math.round((phase === "in" ? edge.left - first : last - edge.right) * pace));
}
