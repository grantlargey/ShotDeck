import { HttpError } from "../utils/http-error.js";
import * as annotationsRepository from "../repositories/annotations.repository.js";
import { mapImageAnnotationRow, withAnnotationImageUrl } from "../serializers/annotations.serializer.js";

function validateAnnotationPayload({ time_seconds, title, body, image_key }, { allowTitleBody = false } = {}) {
    return (
        typeof time_seconds === "number" &&
        Number.isFinite(time_seconds) &&
        time_seconds >= 0 &&
        (!allowTitleBody || title === undefined || title === null || typeof title === "string") &&
        (!allowTitleBody || body === undefined || body === null || typeof body === "string") &&
        (image_key === undefined || image_key === null || typeof image_key === "string")
    );
}

async function toImageAnnotationResponse(row) {
    return mapImageAnnotationRow(await withAnnotationImageUrl(row));
}

export async function createAnnotation(db, movieId, body) {
    const { time_seconds, title, body: textBody, image_key } = body;

    if (!validateAnnotationPayload(body)) {
        throw new HttpError(
            400,
            "Invalid body. Expected { time_seconds:number, (optional) image_key:string }"
        );
    }

    const movie = await annotationsRepository.ensureMovieExists(db, movieId);
    if (!movie) throw new HttpError(404, "Movie not found");

    const row = await annotationsRepository.createAnnotationRecord(db, {
        movieId,
        timeSeconds: time_seconds,
        title: typeof title === "string" ? title.trim() : "",
        body: typeof textBody === "string" && textBody.trim() ? textBody.trim() : null,
        imageKey: image_key,
    });

    return toImageAnnotationResponse(row);
}

export async function listAnnotations(db, movieId) {
    const rows = await annotationsRepository.listAnnotationsForMovie(db, movieId);
    return Promise.all(rows.map(toImageAnnotationResponse));
}

export async function updateAnnotation(db, { movieId, annotationId, body }) {
    const { time_seconds, title, body: textBody, image_key } = body || {};

    if (!validateAnnotationPayload(body || {}, { allowTitleBody: true })) {
        throw new HttpError(
            400,
            "Invalid body. Expected { time_seconds:number, (optional) image_key:string }"
        );
    }

    const existing = await annotationsRepository.findAnnotationForMovie(db, { movieId, annotationId });
    if (!existing) throw new HttpError(404, "Annotation not found");

    const row = await annotationsRepository.updateAnnotationRecord(db, {
        movieId,
        annotationId,
        timeSeconds: time_seconds,
        title: typeof title === "string" ? title.trim() : "",
        body: typeof textBody === "string" && textBody.trim() ? textBody.trim() : null,
        imageKey: image_key === undefined ? existing.image_key : image_key ?? null,
    });

    return toImageAnnotationResponse(row);
}

export async function deleteAnnotation(db, { movieId, annotationId }) {
    const deleted = await annotationsRepository.deleteAnnotationRecord(db, { movieId, annotationId });
    if (!deleted) throw new HttpError(404, "Annotation not found");
}
