import { Router } from "express";
import * as uploadsController from "../controllers/uploads.controller.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();

// Presigning grants a write to the bucket, so it is admin-only. Viewing
// existing files stays public.
router.post("/uploads/presign", requireAdmin, uploadsController.presignUpload);
router.get("/uploads/view-url", uploadsController.getViewUrl);

export default router;
