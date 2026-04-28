import { api } from "@/shared/api";

export const scriptSceneActions = {
  create: (movieId, scriptId, payload) => api.createScriptScene(movieId, scriptId, payload),
  update: (movieId, scriptId, sceneId, payload) =>
    api.updateScriptScene(movieId, scriptId, sceneId, payload),
  delete: (movieId, scriptId, sceneId) => api.deleteScriptScene(movieId, scriptId, sceneId),
};
