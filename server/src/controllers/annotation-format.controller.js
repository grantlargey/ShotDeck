import { formatAnnotationText } from "../services/annotation-format.service.js";

export async function formatAnnotation(req, res) {
    const rawText = req.body?.rawText;

    if (typeof rawText !== "string" || !rawText.trim()) {
        return res.status(400).json({ error: "Invalid body. Expected { rawText:string }" });
    }

    if (rawText.length > 50000) {
        return res.status(400).json({ error: "rawText is too large." });
    }

    try {
        const { formattedText, accepted } = await formatAnnotationText(rawText);
        return res.json({
            rawText,
            formattedText: formattedText || rawText,
            accepted: Boolean(accepted),
        });
    } catch (err) {
        console.error("POST /api/annotations/format error:", err?.message || err);
        return res.json({
            rawText,
            formattedText: rawText,
            accepted: false,
        });
    }
}
