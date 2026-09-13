import { useEffect, useState } from "react";
import { sortAnnotationsByTime } from "@/entities/annotation";
import { sortScriptScenes } from "@/entities/script-scene";
import { api } from "@/shared/api";

const EMPTY = [];

/**
 * A film's stills and a script's scenes for the scene viewer. Pages that
 * already hold a list pass it in, so their edits show up at once; anything
 * else is fetched once per open dialog, so stepping back to a title doesn't
 * refetch. A list is `null` while it loads.
 */
export function useSceneViewerData({ movieId, scriptId, stills, scriptScenes }) {
  const [fetched, setFetched] = useState({ stills: {}, scenes: {} });
  const stillsEntry = movieId ? fetched.stills[movieId] : undefined;
  const scenesEntry = scriptId ? fetched.scenes[scriptId] : undefined;
  const needsStills = !stills && Boolean(movieId) && !stillsEntry;
  const needsScenes = !scriptScenes && Boolean(movieId && scriptId) && !scenesEntry;

  useEffect(() => {
    if (!needsStills) return undefined;
    let cancelled = false;
    api
      .listAnnotations(movieId)
      .then((rows) => ({ rows: sortAnnotationsByTime(rows), failed: false }))
      .catch(() => ({ rows: EMPTY, failed: true }))
      .then((entry) => {
        if (!cancelled) setFetched((prev) => ({ ...prev, stills: { ...prev.stills, [movieId]: entry } }));
      });
    return () => {
      cancelled = true;
    };
  }, [needsStills, movieId]);

  useEffect(() => {
    if (!needsScenes) return undefined;
    let cancelled = false;
    api
      .listScriptScenes(movieId, scriptId)
      .then((rows) => ({ rows: sortScriptScenes(rows), failed: false }))
      .catch(() => ({ rows: EMPTY, failed: true }))
      .then((entry) => {
        if (!cancelled) setFetched((prev) => ({ ...prev, scenes: { ...prev.scenes, [scriptId]: entry } }));
      });
    return () => {
      cancelled = true;
    };
  }, [needsScenes, movieId, scriptId]);

  return {
    stills: stills || (movieId ? stillsEntry?.rows ?? null : EMPTY),
    stillsFailed: !stills && Boolean(stillsEntry?.failed),
    scriptScenes: scriptScenes || (scriptId ? scenesEntry?.rows ?? null : EMPTY),
    scenesFailed: !scriptScenes && Boolean(scenesEntry?.failed),
  };
}
