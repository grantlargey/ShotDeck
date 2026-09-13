import { Router } from "express";
import * as annotationsController from "../controllers/annotations.controller.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();

router.post("/movies/:id/annotations", requireAdmin, annotationsController.createAnnotation);
router.get("/movies/:id/annotations", annotationsController.listAnnotations);
router.put(
    "/movies/:movieId/annotations/:annotationId",
    requireAdmin,
    annotationsController.updateAnnotation
);
router.delete(
    "/movies/:movieId/annotations/:annotationId",
    requireAdmin,
    annotationsController.deleteAnnotation
);

export default router;
