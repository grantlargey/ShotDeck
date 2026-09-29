import { useMemo, useState } from "react";
import { sortScriptScenesByTime } from "@/entities/script-scene/model/capturedScene.js";
import { createSceneViewerCursor, resolveSceneViewerCursor, setSceneViewerView,
  stepSceneViewerToScene, stepSceneViewerToStill } from "./sceneViewerCursor.js";
import { useSceneViewerData } from "./useSceneViewerData.js";

/**
 * Owns navigation and list resolution for search results, a script, or a film.
 * `source.scenes` is an optional stepping list, even across films. `source.film`
 * identifies the owner of any supplied stills and complete scriptScenes. Lists
 * supplied by the page stay live across edits; missing lists load on demand.
 * `initial` is read once per mounted viewer. Callers only select a tab or step.
 */
export function useSceneViewer({ initial, source }) {
  const { scenes, film } = source;
  const [cursor, setCursor] = useState(() => createSceneViewerCursor({
    view: initial.view ?? "script", sceneId: initial.sceneId, stillId: initial.stillId,
    scenes: scenes ?? film?.scriptScenes, stills: film?.stills,
    context: { movieId: film?.id, scriptId: film?.scriptId, movieTitle: film?.title },
  }));
  const ownsFilm = film?.id === cursor.context.movieId;
  const data = useSceneViewerData({
    movieId: cursor.context.movieId,
    scriptId: cursor.context.scriptId,
    stills: ownsFilm ? film.stills : undefined,
    scriptScenes: ownsFilm && film?.scriptId === cursor.context.scriptId ? film.scriptScenes : undefined,
  });
  // A page's own list steps in the order it shows there; a whole script steps
  // in film order, the order the still tab already steps in, because a script's
  // scenes need not run down its pages in the order the film plays them.
  const stepScenes = useMemo(
    () => scenes ?? (data.scriptScenes ? sortScriptScenesByTime(data.scriptScenes) : []),
    [scenes, data.scriptScenes]
  );
  const current = resolveSceneViewerCursor(cursor, { scenes: stepScenes, ...data });
  const showStill = cursor.view === "still";
  const index = showStill ? current.stillIndex : current.sceneIndex;
  const count = showStill ? data.stills?.length : stepScenes.length;
  const prev = showStill ? current.prevStill : current.prevScene;
  const next = showStill ? current.nextStill : current.nextScene;
  return {
    view: cursor.view,
    title: cursor.context.movieTitle || "Untitled project",
    movieId: cursor.context.movieId,
    stillLeads: cursor.lead === "still",
    scene: current.scene, still: current.still,
    sceneStatus: current.sceneStatus, stillStatus: current.stillStatus,
    counter: index >= 0 ? `${index + 1} / ${count}` : null,
    hasPrev: Boolean(prev), hasNext: Boolean(next),
    setView: (view) => setCursor((value) => setSceneViewerView(value, view)),
    step(delta) {
      const target = delta < 0 ? prev : next;
      if (!target) return;
      setCursor(showStill
        ? stepSceneViewerToStill(cursor, target, { scenes: stepScenes, scriptScenes: data.scriptScenes })
        : stepSceneViewerToScene(cursor, target));
    },
  };
}
