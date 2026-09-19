import { momentSeconds } from "@/entities/script-scene/model/filmTiming.js";
import {
  findFirstStillInScene,
  findSceneAtTime,
  getSceneFirstStill,
} from "@/entities/script-scene/model/sceneStill.js";

/**
 * Navigation state for the shared scene viewer.
 *
 * The viewer shows a moment of a film two ways: a captured scene's script, or
 * a film still. Whichever the reader last stepped through leads, and the other
 * tab follows it:
 * - stepping scenes points the still tab at each scene's first still;
 * - stepping stills points the script tab at the scene containing each still,
 *   or leaves it unavailable when no scene covers that moment.
 *
 * Script-tab arrows walk the page's scene list (search results, or a script's
 * scenes). A scene reached through stills can sit outside that list; its
 * arrows then continue from the listed scene the reader left, on whichever
 * side its timing falls.
 */

function findById(rows, id) {
  if (!id || !Array.isArray(rows)) return null;
  return rows.find((row) => row.id === id) || null;
}

function findNearestStill(stills, seconds) {
  if (seconds === null || !Array.isArray(stills) || stills.length === 0) return null;
  const distance = (still) => Math.abs((momentSeconds(still.time_seconds) ?? Infinity) - seconds);
  return stills.reduce((nearest, still) => (distance(still) < distance(nearest) ? still : nearest));
}

/**
 * Opens on a scene (`sceneId`) or a still (`stillId`). `context` supplies the
 * movie and script when the opening scene row doesn't carry them.
 */
export function createSceneViewerCursor({ view, sceneId = null, stillId = null, scenes, stills, context = {} }) {
  const scene = findById(scenes, sceneId);
  const still = findById(stills, stillId);
  return {
    view,
    lead: sceneId ? "scene" : "still",
    sceneId,
    stillId: sceneId ? null : stillId,
    stillTime: still ? momentSeconds(still.time_seconds) : null,
    anchorSceneId: sceneId,
    context: {
      movieId: scene?.movie_id ?? context.movieId ?? null,
      scriptId: scene?.script_id ?? context.scriptId ?? null,
      movieTitle: scene?.movie_title || context.movieTitle || "",
    },
  };
}

export function setSceneViewerView(cursor, view) {
  return cursor.view === view ? cursor : { ...cursor, view };
}

/** Moves to a scene from the list; the still tab follows to its first still. */
export function stepSceneViewerToScene(cursor, scene) {
  return {
    ...cursor,
    lead: "scene",
    sceneId: scene.id,
    stillId: null,
    stillTime: null,
    anchorSceneId: scene.id,
    context: {
      movieId: scene.movie_id ?? cursor.context.movieId,
      scriptId: scene.script_id ?? cursor.context.scriptId,
      movieTitle: scene.movie_title || cursor.context.movieTitle,
    },
  };
}

/** Moves to a still; the script tab follows to the scene containing it. */
export function stepSceneViewerToStill(cursor, still, { scenes, scriptScenes }) {
  const covering = findSceneAtTime(scriptScenes, still.time_seconds);
  const listed = covering ? findById(scenes, covering.id) : null;
  return {
    ...cursor,
    lead: "still",
    sceneId: null,
    stillId: still.id,
    stillTime: momentSeconds(still.time_seconds),
    anchorSceneId: listed ? listed.id : cursor.anchorSceneId,
  };
}

function getSceneStatus(cursor, scene, scriptScenes, scenesFailed) {
  if (scene) return "ready";
  if (cursor.lead === "scene") return "none";
  if (!cursor.context.scriptId) return "no-script";
  if (scenesFailed) return "failed";
  return Array.isArray(scriptScenes) ? "none" : "loading";
}

function getStillStatus(cursor, still, stills, stillsFailed) {
  if (still) return "ready";
  if (stillsFailed) return "failed";
  return !Array.isArray(stills) && cursor.lead === "still" ? "loading" : "none";
}

function getSceneNeighbors(scenes, scene, anchorSceneId) {
  const index = scene ? scenes.findIndex((row) => row.id === scene.id) : -1;
  if (index >= 0) {
    return { index, prev: scenes[index - 1] || null, next: scenes[index + 1] || null };
  }

  const anchorIndex = scene ? scenes.findIndex((row) => row.id === anchorSceneId) : -1;
  if (anchorIndex < 0) return { index: -1, prev: null, next: null };

  const anchor = scenes[anchorIndex];
  const isLater = (momentSeconds(scene.start_time_seconds) ?? 0) >= (momentSeconds(anchor.start_time_seconds) ?? 0);
  return isLater
    ? { index: -1, prev: anchor, next: scenes[anchorIndex + 1] || null }
    : { index: -1, prev: scenes[anchorIndex - 1] || null, next: anchor };
}

/**
 * What the viewer shows for a cursor. Lists that are still loading are
 * `null`: `scenes` is the script tab's stepping list, `scriptScenes` the whole
 * script (to find the scene for a still), and `stills` the film's stills.
 */
export function resolveSceneViewerCursor(cursor, { scenes, scriptScenes, stills, scenesFailed = false, stillsFailed = false }) {
  const list = Array.isArray(scenes) ? scenes : [];
  let scene = null;
  let still = null;

  if (cursor.lead === "scene") {
    scene = findById(list, cursor.sceneId) || findById(scriptScenes, cursor.sceneId);
    still = Array.isArray(stills) ? findFirstStillInScene(stills, scene) : getSceneFirstStill(scene);
  } else {
    // A deleted still hands over to the one nearest its time.
    still = findById(stills, cursor.stillId) || findNearestStill(stills, cursor.stillTime);
    const covering = still ? findSceneAtTime(scriptScenes, still.time_seconds) : null;
    scene = covering ? findById(list, covering.id) || covering : null;
  }

  const sceneNeighbors = getSceneNeighbors(list, scene, cursor.anchorSceneId);
  const stillIndex = still && Array.isArray(stills) ? stills.findIndex((row) => row.id === still.id) : -1;

  return {
    scene,
    still,
    sceneStatus: getSceneStatus(cursor, scene, scriptScenes, scenesFailed),
    stillStatus: getStillStatus(cursor, still, stills, stillsFailed),
    sceneIndex: sceneNeighbors.index,
    prevScene: sceneNeighbors.prev,
    nextScene: sceneNeighbors.next,
    stillIndex,
    prevStill: stillIndex > 0 ? stills[stillIndex - 1] : null,
    nextStill: stillIndex >= 0 ? stills[stillIndex + 1] || null : null,
  };
}
