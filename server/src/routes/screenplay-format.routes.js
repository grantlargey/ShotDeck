import express, { Router } from "express";
import * as screenplayFormatController from "../controllers/screenplay-format.controller.js";
import { requireAdmin } from "../middleware/require-admin.js";

const router = Router();

// Requests carry cropped page images, so this route parses its own larger
// body. It is mounted before the app-wide 2mb JSON parser. It spends OpenAI
// credit, so it is admin-only like the writes it serves.
router.post(
    "/api/script-scenes/format",
    requireAdmin,
    express.json({ limit: "12mb" }),
    screenplayFormatController.formatScreenplay
);

export default router;
