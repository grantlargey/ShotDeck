import express, { Router } from "express";
import * as screenplayFormatController from "../controllers/screenplay-format.controller.js";

const router = Router();

// Requests carry cropped page images, so this route parses its own larger
// body. It is mounted before the app-wide 2mb JSON parser.
router.post(
    "/api/script-scenes/format",
    express.json({ limit: "12mb" }),
    screenplayFormatController.formatScreenplay
);

export default router;
