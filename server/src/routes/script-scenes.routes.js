import { Router } from "express";
import * as scriptScenesController from "../controllers/script-scenes.controller.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();

router.post(
    "/movies/:movieId/scripts/:scriptId/scene-annotations",
    requireAdmin,
    scriptScenesController.createScriptScene
);
router.get(
    "/movies/:movieId/scripts/:scriptId/scene-annotations",
    scriptScenesController.listScriptScenes
);
router.put(
    "/movies/:movieId/scripts/:scriptId/scene-annotations/:sceneId",
    requireAdmin,
    scriptScenesController.updateScriptScene
);
router.delete(
    "/movies/:movieId/scripts/:scriptId/scene-annotations/:sceneId",
    requireAdmin,
    scriptScenesController.deleteScriptScene
);

router.get("/script-scenes", scriptScenesController.searchScriptScenes);

export default router;
