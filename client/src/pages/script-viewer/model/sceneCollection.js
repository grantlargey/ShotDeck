import { useEffect, useState } from "react";
import { sortScriptScenes } from "@/entities/script-scene/model/capturedScene.js";
import {
  createScriptScene,
  deleteScriptScene,
  listScriptScenes,
  updateScriptScene,
} from "@/shared/api/scriptScenes.js";

/*
 * The script's captured scenes, as the script viewer holds them: the list the
 * page reads, its order, the create, update and delete requests, and which
 * request is running.
 *
 * The collection owns the order (`sortScriptScenes`, the API's list order), so
 * a saved scene lands where the API would list it without reloading the list.
 * It never writes to the scene draft itself: it calls back into the draft
 * module, which decides whether a response may replace the open draft.
 *
 * It owns no wording. A request resolves with the error it failed on, and the
 * page turns that into a notice.
 */

/**
 * Loads and keeps the captured scenes of one script.
 *
 * ```js
 * const scenes = useSceneCollection({ movieId, scriptId });
 * ```
 *
 * | Field | Meaning |
 * |---|---|
 * | `list` | The captured scenes in the API's list order. Its identity changes only when the scenes do. |
 * | `loading` | True until the first load settles. |
 * | `saving` | True while a create or update request runs. |
 * | `deletingSceneId` | The id being deleted, else `""`. |
 *
 * A failed load reaches `onLoadError(error)`, which must keep one identity for
 * the life of the page. The page treats it as the whole page's load failing.
 *
 * `save` and `remove` resolve with `{ ok: true }` (save also carries the saved
 * `scene`) or `{ ok: false, error }`. A failed request leaves the list as it
 * was and calls neither draft callback.
 */
export function useSceneCollection({ movieId, scriptId, onLoadError }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingSceneId, setDeletingSceneId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listScriptScenes(movieId, scriptId)
      .then((rows) => {
        if (!cancelled) setList(sortScriptScenes(Array.isArray(rows) ? rows : []));
      })
      .catch((error) => {
        // `list` is left as it was rather than emptied, so a failed reload keeps
        // the scenes already on screen. On a first load there are none.
        if (!cancelled) onLoadError(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movieId, scriptId, onLoadError]);

  // The requests below need no cancellation guard, unlike the load above:
  // `ScriptViewerRoute` keys the page by `scriptId`, so another script is another
  // page with its own collection, and `movieId` can't change without the script
  // changing. A route that dropped that key would have to add one, or a late
  // response could land in a collection that has moved to another script.
  return {
    list,
    loading,
    saving,
    deletingSceneId,

    /**
     * Creates the scene, or updates `sceneId` when there is one, from a payload
     * the draft built. On success the saved scene takes its place in the list
     * and reaches the draft's `applySaved`.
     */
    async save({ sceneId = "", payload, applySaved }) {
      setSaving(true);
      try {
        const scene = sceneId
          ? await updateScriptScene(movieId, scriptId, sceneId, payload)
          : await createScriptScene(movieId, scriptId, payload);
        setList((rows) => sortScriptScenes([...rows.filter((row) => row.id !== scene.id), scene]));
        applySaved(scene);
        return { ok: true, scene };
      } catch (error) {
        return { ok: false, error };
      } finally {
        setSaving(false);
      }
    },

    /**
     * Deletes a captured scene. The draft's `prepareDelete` is called before the
     * request, so it snapshots the draft as it was when the admin asked, and the
     * completion callback it returns only after the scene is gone.
     */
    async remove({ sceneId, prepareDelete }) {
      const completeDelete = prepareDelete(sceneId);
      setDeletingSceneId(sceneId);
      try {
        await deleteScriptScene(movieId, scriptId, sceneId);
        setList((rows) => rows.filter((row) => row.id !== sceneId));
        completeDelete();
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      } finally {
        setDeletingSceneId("");
      }
    },
  };
}
