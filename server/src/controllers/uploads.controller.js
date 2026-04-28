import * as uploadsService from "../services/uploads.service.js";
import { isHttpError } from "../utils/http-error.js";

export async function presignUpload(req, res) {
    try {
        return res.json(await uploadsService.createUploadPresign(req.body));
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("POST /uploads/presign error:", err?.name, err?.message);
        console.error(err);
        return res.status(500).json({ error: "Failed to presign upload" });
    }
}

export async function getViewUrl(req, res) {
    try {
        return res.json(await uploadsService.createViewUrl(req.query.key));
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("GET /uploads/view-url error:", err);
        return res.status(500).json({ error: "Failed to generate view URL" });
    }
}
