import { getScriptScenePageRange } from "./scriptSceneText.js";

/** Script viewer path that opens a scene for editing, scrolled to its first page. */
export function getSceneScriptPath(scene) {
  const params = new URLSearchParams();
  params.set("sceneId", scene.id);
  params.set("page", String(getScriptScenePageRange(scene).pageStart));
  return `/movies/${scene.movie_id}/scripts/${scene.script_id}?${params.toString()}`;
}
