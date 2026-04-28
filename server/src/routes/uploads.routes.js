import { Router } from "express";
import * as uploadsController from "../controllers/uploads.controller.js";

const router = Router();

router.post("/uploads/presign", uploadsController.presignUpload);
router.get("/uploads/view-url", uploadsController.getViewUrl);

export default router;
