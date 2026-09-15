import { Router } from "express";
import { requireAdmin } from "../middleware/require-admin.js";
import * as uploadsService from "../services/uploads.service.js";

/** Upload routes. Validation and signing live in services/uploads.service.js. */
const router = Router();

// Presigning grants a write to the bucket, so it is admin-only. Viewing
// existing files stays public.
router.post("/uploads/presign", requireAdmin, async (req, res) => {
    res.json(await uploadsService.createUploadPresign(req.body));
});

router.get("/uploads/view-url", async (req, res) => {
    res.json(await uploadsService.createViewUrl(req.query.key));
});

export default router;
