import { filmTimingCovers, momentSeconds } from "./filmTiming.js";

/**
 * Film stills and captured scenes: a scene's first still is the earliest still
 * with an image inside its film timing, and a moment belongs to the one scene
 * whose film timing contains it. Scenes of a script can't share a second, so
 * no moment falls in two of them.
 */

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

/** The scene whose timing contains `seconds`, or null. */
export function findSceneAtTime(scenes, seconds) {
  const time = momentSeconds(seconds);
  if (time === null || !Array.isArray(scenes)) return null;
  return scenes.find((scene) => filmTimingCovers(scene, time)) ?? null;
}
