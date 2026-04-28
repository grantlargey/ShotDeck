import { Router } from "express";
import * as annotationsController from "../controllers/annotations.controller.js";
import * as formatController from "../controllers/annotation-format.controller.js";

const router = Router();

router.post("/api/annotations/format", formatController.formatAnnotation);

router.post("/movies/:id/annotations", annotationsController.createAnnotation);
router.get("/movies/:id/annotations", annotationsController.listAnnotations);
router.put(
    "/movies/:movieId/annotations/:annotationId",
    annotationsController.updateAnnotation
);
router.delete(
    "/movies/:movieId/annotations/:annotationId",
    annotationsController.deleteAnnotation
);

export default router;
