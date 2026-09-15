import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time.js";

/*
 * Film timing: the start and end time within the film that a captured scene
 * covers, in whole seconds. Admins type times as HH:MM:SS or MM:SS; the API
 * stores seconds. A runtime of 0 means the film's runtime is unknown, so no
 * time is capped.
 *
 * Captured scenes of the same script can't overlap. Two timings overlap when
 * `a.start < b.end && b.start < a.end`, so scenes that only touch are fine,
 * and a zero-length timing overlaps only a scene that strictly contains it.
 */

/** A stored moment of the film in seconds (a number or numeric string), or null when it's missing or not a number. */
export function momentSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

function storedTiming(scene) {
  const start = momentSeconds(scene?.start_time_seconds);
  const end = momentSeconds(scene?.end_time_seconds);
  return start === null || end === null ? null : { start, end };
}

function isPastRuntime(seconds, runtimeSeconds) {
  const runtime = Number(runtimeSeconds);
  return Number.isFinite(runtime) && runtime > 0 && seconds > runtime;
}

function checkTypedTiming(startTime, endTime, runtimeSeconds, whileTyping) {
  const startText = String(startTime ?? "").trim();
  const endText = String(endTime ?? "").trim();
  const start = parseTimeInputToSeconds(startText);
  const end = parseTimeInputToSeconds(endText);

  if (!whileTyping && ((startText && start === null) || (endText && end === null))) {
    return { error: "Use HH:MM:SS (or MM:SS) for the start and end times." };
  }
  if (!whileTyping && (start === null || end === null)) {
    return { error: "Enter a start and an end time for this scene." };
  }
  if (start !== null && end !== null && end < start) {
    return { error: "The end time must be at or after the start time." };
  }
  if (isPastRuntime(start ?? 0, runtimeSeconds) || isPastRuntime(end ?? 0, runtimeSeconds)) {
    return { error: `Times can't be later than the film's runtime (${formatSecondsToHms(runtimeSeconds)}).` };
  }
  return { start, end };
}

/**
 * Checks a captured scene's typed film timing for saving: both times present
 * and readable, the end at or after the start, and neither past the film's
 * runtime. Returns `{ start, end }` in seconds, or `{ error }`.
 */
export function parseFilmTiming(startTime, endTime, runtimeSeconds) {
  return checkTypedTiming(startTime, endTime, runtimeSeconds, false);
}

/**
 * What's wrong with film timing the admin is still typing, or "". Missing and
 * half-typed times aren't flagged; saving reports them.
 */
export function filmTimingErrorWhileTyping(startTime, endTime, runtimeSeconds) {
  return checkTypedTiming(startTime, endTime, runtimeSeconds, true).error ?? "";
}

/**
 * Checks a single typed moment of the film, such as a still's timestamp.
 * Returns `{ seconds }`, or `{ error }`.
 */
export function parseFilmMoment(text, runtimeSeconds) {
  const seconds = parseTimeInputToSeconds(text);
  if (seconds === null) {
    return { error: "Use HH:MM:SS (or MM:SS) for the timestamp." };
  }
  if (isPastRuntime(seconds, runtimeSeconds)) {
    return { error: `The timestamp can't be later than the film's runtime (${formatSecondsToHms(runtimeSeconds)}).` };
  }
  return { seconds };
}

/** A captured scene's film timing as a label, "00:10:00 – 00:12:00". */
export function formatFilmTiming(scene) {
  const start = scene?.start_time_seconds;
  const end = scene?.end_time_seconds;
  if (momentSeconds(start) === null && momentSeconds(end) === null) return "No timing yet";
  return `${formatSecondsToHms(start)} – ${formatSecondsToHms(end)}`;
}

/** Whether a moment falls inside a captured scene's film timing, counting both endpoints. */
export function filmTimingCovers(scene, seconds) {
  const timing = storedTiming(scene);
  const moment = momentSeconds(seconds);
  return timing !== null && moment !== null && moment >= timing.start && moment <= timing.end;
}

/**
 * The first captured scene whose film timing overlaps `timing` (`{ start, end }`
 * in seconds), or null. Skips the scene with `excludeSceneId`, usually the
 * draft's own saved scene, and scenes without usable timing.
 */
export function findOverlappingFilmTiming(scenes, timing, excludeSceneId) {
  const start = momentSeconds(timing?.start);
  const end = momentSeconds(timing?.end);
  if (start === null || end === null) return null;

  for (const scene of Array.isArray(scenes) ? scenes : []) {
    if (excludeSceneId && scene?.id === excludeSceneId) continue;
    const other = storedTiming(scene);
    if (other && start < other.end && other.start < end) return scene;
  }
  return null;
}
