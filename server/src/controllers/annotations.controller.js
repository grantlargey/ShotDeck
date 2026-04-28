import { pool } from "../db.js";
import * as annotationsService from "../services/annotations.service.js";
import { isHttpError } from "../utils/http-error.js";

export async function createAnnotation(req, res) {
    try {
        const row = await annotationsService.createAnnotation(pool, req.params.id, req.body);
        return res.status(201).json(row);
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("POST /movies/:id/annotations error:", err);
        return res.status(500).json({ error: "Failed to create annotation" });
    }
}

export async function listAnnotations(req, res) {
    try {
        return res.json(await annotationsService.listAnnotations(pool, req.params.id));
    } catch (err) {
        console.error("GET /movies/:id/annotations error:", err);
        return res.status(500).json({ error: "Failed to fetch annotations" });
    }
}

export async function updateAnnotation(req, res) {
    try {
        const row = await annotationsService.updateAnnotation(pool, {
            movieId: req.params.movieId,
            annotationId: req.params.annotationId,
            body: req.body,
        });
        return res.json(row);
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: err.message });
    }
}

export async function deleteAnnotation(req, res) {
    try {
        await annotationsService.deleteAnnotation(pool, {
            movieId: req.params.movieId,
            annotationId: req.params.annotationId,
        });
        return res.status(204).send();
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("DELETE /movies/:movieId/annotations/:annotationId error:", err);
        return res.status(500).json({ error: "Failed to delete annotation" });
    }
}
