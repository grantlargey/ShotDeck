/**
 * Film-still helpers for script scenes. The timing rules mirror the API: a
 * scene's first still is the earliest still with an image inside its timing,
 * and a moment belongs to the shortest scene whose timing contains it.
 */

function toSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

function coversTime(scene, seconds) {
  const start = toSeconds(scene?.start_time_seconds);
  const end = toSeconds(scene?.end_time_seconds);
  return start !== null && end !== null && seconds >= start && seconds <= end;
}

function sceneLength(scene) {
  return toSeconds(scene.end_time_seconds) - toSeconds(scene.start_time_seconds);
}

function isCloserMatch(candidate, current) {
  const lengthDiff = sceneLength(candidate) - sceneLength(current);
  if (lengthDiff !== 0) return lengthDiff < 0;
  const startDiff = toSeconds(candidate.start_time_seconds) - toSeconds(current.start_time_seconds);
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
    stills.find((still) => {
      const seconds = toSeconds(still.time_seconds);
      return Boolean(still.image_key || still.image_url) && seconds !== null && coversTime(scene, seconds);
    }) || null
  );
}

/** The shortest scene whose timing contains `seconds`; the earlier start wins a tie. */
export function findSceneAtTime(scenes, seconds) {
  const time = toSeconds(seconds);
  if (time === null || !Array.isArray(scenes)) return null;

  let match = null;
  for (const scene of scenes) {
    if (coversTime(scene, time) && (!match || isCloserMatch(scene, match))) match = scene;
  }
  return match;
}
