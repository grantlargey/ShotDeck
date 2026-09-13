import { pool } from "../db.js";
import * as annotationsService from "../services/annotations.service.js";

export async function createAnnotation(req, res) {
    const row = await annotationsService.createAnnotation(pool, req.params.id, req.body);
    return res.status(201).json(row);
}

export async function listAnnotations(req, res) {
    return res.json(await annotationsService.listAnnotations(pool, req.params.id));
}

export async function updateAnnotation(req, res) {
    const row = await annotationsService.updateAnnotation(pool, {
        movieId: req.params.movieId,
        annotationId: req.params.annotationId,
        body: req.body,
    });
    return res.json(row);
}

export async function deleteAnnotation(req, res) {
    await annotationsService.deleteAnnotation(pool, {
        movieId: req.params.movieId,
        annotationId: req.params.annotationId,
    });
    return res.status(204).send();
}
