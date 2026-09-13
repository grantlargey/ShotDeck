export function sortAnnotationsByTime(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => a.time_seconds - b.time_seconds);
}

export function getTimelinePositionPercent(annotation, runtimeSeconds) {
  const runtime = Number(runtimeSeconds);
  if (!annotation || !Number.isFinite(runtime) || runtime <= 0) return 0;
  return Math.min(100, (Number(annotation.time_seconds || 0) / runtime) * 100);
}

/**
 * Counts stills into `binCount` equal slices of the runtime for the timeline's
 * density bars. Stills past the runtime land in the last slice.
 */
export function getTimelineBins(annotations, runtimeSeconds, binCount) {
  const count = Math.max(0, Math.floor(binCount) || 0);
  const bins = new Array(count).fill(0);
  if (count === 0) return bins;

  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    const percent = getTimelinePositionPercent(annotation, runtimeSeconds);
    bins[Math.min(count - 1, Math.floor((percent / 100) * count))] += 1;
  }
  return bins;
}

/**
 * Index of the time-sorted still closest to `percent` along the timeline, or
 * -1 when there are none. Ties go to the earlier still.
 */
export function findNearestAnnotationIndex(annotations, runtimeSeconds, percent) {
  const rows = Array.isArray(annotations) ? annotations : [];
  if (rows.length === 0) return -1;

  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (getTimelinePositionPercent(rows[mid], runtimeSeconds) < percent) lo = mid + 1;
    else hi = mid;
  }

  // `lo` is the first still at or after `percent`; the one before may be closer.
  if (lo > 0) {
    const before = percent - getTimelinePositionPercent(rows[lo - 1], runtimeSeconds);
    const after = getTimelinePositionPercent(rows[lo], runtimeSeconds) - percent;
    if (before <= after) return lo - 1;
  }
  return lo;
}

// Label and tick spacing by runtime, so a short film and a long one both get a few labels.
const SCALE_STEPS = [
  { upTo: 20 * 60, label: 5 * 60, tick: 60 },
  { upTo: 60 * 60, label: 15 * 60, tick: 5 * 60 },
  { upTo: 3 * 60 * 60, label: 30 * 60, tick: 10 * 60 },
  { upTo: Infinity, label: 60 * 60, tick: 20 * 60 },
];

/**
 * Ruler marks between the start and end of a runtime: ticks (every label is
 * also a major tick) and the labelled times, leaving out a label that would
 * crowd the runtime label at the end.
 */
export function getTimelineScale(runtimeSeconds) {
  const runtime = Number(runtimeSeconds);
  if (!Number.isFinite(runtime) || runtime <= 0) return { ticks: [], labels: [] };

  const step = SCALE_STEPS.find((s) => runtime <= s.upTo);
  const ticks = [];
  for (let seconds = step.tick; seconds < runtime; seconds += step.tick) {
    ticks.push({ seconds, percent: (seconds / runtime) * 100, major: seconds % step.label === 0 });
  }
  const labels = ticks.filter((tick) => tick.major && runtime - tick.seconds >= step.label / 2);
  return { ticks, labels };
}
