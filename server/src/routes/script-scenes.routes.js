import { Router } from "express";
import * as scriptScenesController from "../controllers/script-scenes.controller.js";

const router = Router();

router.post(
    "/movies/:movieId/scripts/:scriptId/scene-annotations",
    scriptScenesController.createScriptScene
);
router.get(
    "/movies/:movieId/scripts/:scriptId/scene-annotations",
    scriptScenesController.listScriptScenes
);
router.put(
    "/movies/:movieId/scripts/:scriptId/scene-annotations/:sceneId",
    scriptScenesController.updateScriptScene
);
router.delete(
    "/movies/:movieId/scripts/:scriptId/scene-annotations/:sceneId",
    scriptScenesController.deleteScriptScene
);

router.get("/script-scenes", scriptScenesController.searchScriptScenes);

export default router;
