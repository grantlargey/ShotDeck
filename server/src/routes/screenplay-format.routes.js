import express, { Router } from "express";
import { requireAdmin } from "../middleware/require-admin.js";
import * as screenplayFormatService from "../services/screenplay-format.service.js";

/** The AI formatter route. Request validation and the OpenAI call live in services/screenplay-format.service.js. */
const router = Router();

// Requests carry cropped page images, so this route parses its own larger
// body. It is mounted before the app-wide 2mb JSON parser. It spends OpenAI
// credit, so it is admin-only like the writes it serves.
router.post("/api/script-scenes/format", requireAdmin, express.json({ limit: "12mb" }), async (req, res) => {
    res.json(await screenplayFormatService.formatScreenplaySelection(req.body));
});

export default router;
