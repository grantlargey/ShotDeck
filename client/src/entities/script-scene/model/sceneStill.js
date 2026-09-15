import { filmTimingCovers, momentSeconds } from "./filmTiming.js";

/**
 * Film stills and captured scenes: a scene's first still is the earliest still
 * with an image inside its film timing, and a moment belongs to the shortest
 * scene whose film timing contains it.
 */

function sceneLength(scene) {
  return momentSeconds(scene.end_time_seconds) - momentSeconds(scene.start_time_seconds);
}

function isCloserMatch(candidate, current) {
  const lengthDiff = sceneLength(candidate) - sceneLength(current);
  if (lengthDiff !== 0) return lengthDiff < 0;
  const startDiff = momentSeconds(candidate.start_time_seconds) - momentSeconds(current.start_time_seconds);
  if (startDiff !== 0) return startDiff < 0;
  return String(candidate.id) < String(current.id);
}

/** The first still the API attached to a scene row, or null. */
export function getSceneFirstStill(scene) {
  return scene?.first_image_annotation?.image_key ? scene.first_image_annotation : null;
}

/** The earliest still with an image inside a scene's timing, from stills sorted by time. */
export function findFirstStillInScene(stills, scene) {
  if (!scene || !Array.isArray(stills)) return null;
  return (
    stills.find((still) => Boolean(still.image_key || still.image_url) && filmTimingCovers(scene, still.time_seconds)) ||
    null
  );
}

/** The shortest scene whose timing contains `seconds`; the earlier start wins a tie. */
export function findSceneAtTime(scenes, seconds) {
  const time = momentSeconds(seconds);
  if (time === null || !Array.isArray(scenes)) return null;

  let match = null;
  for (const scene of scenes) {
    if (filmTimingCovers(scene, time) && (!match || isCloserMatch(scene, match))) match = scene;
  }
  return match;
}
