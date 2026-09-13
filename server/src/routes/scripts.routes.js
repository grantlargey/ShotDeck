import { Router } from "express";
import * as scriptsController from "../controllers/scripts.controller.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();

router.post("/movies/:id/scripts", requireAdmin, scriptsController.saveScript);
router.get("/movies/:id/scripts", scriptsController.listScripts);
router.get("/movies/:movieId/scripts/:scriptId", scriptsController.getScript);
router.get("/movies/:movieId/scene-by-time", scriptsController.resolveSceneByTime);

export default router;
