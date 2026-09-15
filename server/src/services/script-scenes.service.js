import { v4 as uuidv4 } from "uuid";
import { findScriptForMovie } from "../repositories/scripts.repository.js";
import * as repository from "../repositories/script-scenes.repository.js";
import { mapScriptSceneRow } from "../serializers/script-scenes.serializer.js";
import { HttpError } from "../utils/http-error.js";
import {
    isFiniteInt,
    normalizeAnchorGeometry,
    normalizeOptionalInt,
    normalizeTags,
} from "../utils/normalize.js";

function conflictError(conflictingRow) {
    return new HttpError(409, "Scene time range overlaps an existing scene in this script.", {
        conflict_scene_id: conflictingRow.id,
        conflict_start_time_seconds: conflictingRow.start_time_seconds,
        conflict_end_time_seconds: conflictingRow.end_time_seconds,
    });
}

function validatePageRange(pageStartParsed, pageEndParsed) {
    return !(
        Number.isNaN(pageStartParsed) ||
        Number.isNaN(pageEndParsed) ||
        (pageStartParsed !== undefined && pageStartParsed !== null && pageStartParsed < 1) ||
        (pageEndParsed !== undefined && pageEndParsed !== null && pageEndParsed < 1) ||
        (pageStartParsed !== undefined &&
            pageStartParsed !== null &&
            pageEndParsed !== undefined &&
            pageEndParsed !== null &&
            pageEndParsed < pageStartParsed)
    );
}

function validateOffsetRange(startOffsetParsed, endOffsetParsed) {
    return !(
        Number.isNaN(startOffsetParsed) ||
        Number.isNaN(endOffsetParsed) ||
        (startOffsetParsed !== undefined && startOffsetParsed !== null && startOffsetParsed < 0) ||
        (endOffsetParsed !== undefined && endOffsetParsed !== null && endOffsetParsed < 0) ||
        (startOffsetParsed !== undefined &&
            startOffsetParsed !== null &&
            endOffsetParsed !== undefined &&
            endOffsetParsed !== null &&
            endOffsetParsed < startOffsetParsed)
    );
}

function buildCreateInput(body) {
    const {
        start_time_seconds,
        end_time_seconds,
        selected_text,
        raw_selected_text,
        formatted_selected_text,
        page_start,
        page_end,
        context_prefix,
        context_suffix,
        start_offset,
        end_offset,
        anchor_geometry,
        tags,
    } = body || {};

    const startTime = Number(start_time_seconds);
    const endTime = Number(end_time_seconds);

    if (!isFiniteInt(startTime) || !isFiniteInt(endTime) || startTime < 0 || endTime < startTime) {
        throw new HttpError(
            400,
            "Invalid body. start_time_seconds and end_time_seconds must be integers where end >= start and start >= 0."
        );
    }

    const pageStartParsed = page_start === null ? null : normalizeOptionalInt(page_start);
    const pageEndParsed = page_end === null ? null : normalizeOptionalInt(page_end);

    if (!validatePageRange(pageStartParsed, pageEndParsed)) {
        throw new HttpError(
            400,
            "Invalid body. page_start/page_end must be positive integers and page_end >= page_start."
        );
    }

    if (
        (context_prefix !== undefined && context_prefix !== null && typeof context_prefix !== "string") ||
        (context_suffix !== undefined && context_suffix !== null && typeof context_suffix !== "string")
    ) {
        throw new HttpError(
            400,
            "Invalid body. context_prefix/context_suffix must be strings when provided."
        );
    }

    const startOffsetParsed = start_offset === null ? null : normalizeOptionalInt(start_offset);
    const endOffsetParsed = end_offset === null ? null : normalizeOptionalInt(end_offset);

    if (!validateOffsetRange(startOffsetParsed, endOffsetParsed)) {
        throw new HttpError(
            400,
            "Invalid body. start_offset/end_offset must be integers where end_offset >= start_offset >= 0."
        );
    }

    const rawSelectedText =
        typeof raw_selected_text === "string"
            ? raw_selected_text
            : typeof selected_text === "string"
                ? selected_text
                : "";
    const formattedSelectedText =
        typeof formatted_selected_text === "string"
            ? formatted_selected_text
            : formatted_selected_text === null
                ? null
                : null;

    if (!rawSelectedText.trim()) {
        throw new HttpError(400, "Invalid body. raw_selected_text must be a non-empty string.");
    }

    const selectedTextToStore =
        typeof selected_text === "string" && selected_text.trim()
            ? selected_text
            : formattedSelectedText && formattedSelectedText.trim()
                ? formattedSelectedText
                : rawSelectedText;

    const tagsNorm = normalizeTags(tags);
    if (tagsNorm === "__INVALID__") {
        throw new HttpError(
            400,
            "Invalid body. tags must be an array of strings or comma-separated string."
        );
    }

    const anchorGeometryNorm = normalizeAnchorGeometry(anchor_geometry);
    if (anchorGeometryNorm === "__INVALID__") {
        throw new HttpError(400, "Invalid body. anchor_geometry must be a JSON array when provided.");
    }

    return {
        startTime,
        endTime,
        pageStart: pageStartParsed === undefined ? null : pageStartParsed,
        pageEnd: pageEndParsed === undefined ? null : pageEndParsed,
        selectedText: selectedTextToStore,
        rawSelectedText,
        formattedSelectedText,
        contextPrefix: context_prefix === undefined ? null : context_prefix,
        contextSuffix: context_suffix === undefined ? null : context_suffix,
        startOffset: startOffsetParsed === undefined ? null : startOffsetParsed,
        endOffset: endOffsetParsed === undefined ? null : endOffsetParsed,
        anchorGeometry: anchorGeometryNorm === undefined ? [] : anchorGeometryNorm,
        tags: tagsNorm === undefined ? [] : tagsNorm,
    };
}

function buildUpdateInput(existingRow, body) {
    const startTimeParsed = normalizeOptionalInt(body.start_time_seconds);
    const endTimeParsed = normalizeOptionalInt(body.end_time_seconds);
    if (Number.isNaN(startTimeParsed) || Number.isNaN(endTimeParsed)) {
        throw new HttpError(400, "start_time_seconds/end_time_seconds must be integers when provided.");
    }

    const nextStartTime =
        startTimeParsed === undefined ? existingRow.start_time_seconds : startTimeParsed;
    const nextEndTime =
        endTimeParsed === undefined ? existingRow.end_time_seconds : endTimeParsed;
    if (!isFiniteInt(nextStartTime) || !isFiniteInt(nextEndTime) || nextStartTime < 0 || nextEndTime < nextStartTime) {
        throw new HttpError(400, "Invalid time range. end_time_seconds must be >= start_time_seconds >= 0.");
    }

    const pageStartParsed =
        body.page_start === undefined
            ? undefined
            : body.page_start === null
                ? null
                : normalizeOptionalInt(body.page_start);
    const pageEndParsed =
        body.page_end === undefined
            ? undefined
            : body.page_end === null
                ? null
                : normalizeOptionalInt(body.page_end);
    if (Number.isNaN(pageStartParsed) || Number.isNaN(pageEndParsed)) {
        throw new HttpError(400, "page_start/page_end must be integers when provided.");
    }
    const nextPageStart = pageStartParsed === undefined ? existingRow.page_start : pageStartParsed;
    const nextPageEnd = pageEndParsed === undefined ? existingRow.page_end : pageEndParsed;
    if (
        (nextPageStart !== null && nextPageStart !== undefined && nextPageStart < 1) ||
        (nextPageEnd !== null && nextPageEnd !== undefined && nextPageEnd < 1) ||
        (nextPageStart !== null &&
            nextPageStart !== undefined &&
            nextPageEnd !== null &&
            nextPageEnd !== undefined &&
            nextPageEnd < nextPageStart)
    ) {
        throw new HttpError(
            400,
            "Invalid page range. page_start/page_end must be positive and page_end >= page_start."
        );
    }

    const startOffsetParsed =
        body.start_offset === undefined
            ? undefined
            : body.start_offset === null
                ? null
                : normalizeOptionalInt(body.start_offset);
    const endOffsetParsed =
        body.end_offset === undefined
            ? undefined
            : body.end_offset === null
                ? null
                : normalizeOptionalInt(body.end_offset);
    if (Number.isNaN(startOffsetParsed) || Number.isNaN(endOffsetParsed)) {
        throw new HttpError(400, "start_offset/end_offset must be integers when provided.");
    }
    const nextStartOffset =
        startOffsetParsed === undefined ? existingRow.start_offset : startOffsetParsed;
    const nextEndOffset =
        endOffsetParsed === undefined ? existingRow.end_offset : endOffsetParsed;
    if (
        (nextStartOffset !== null && nextStartOffset !== undefined && nextStartOffset < 0) ||
        (nextEndOffset !== null && nextEndOffset !== undefined && nextEndOffset < 0) ||
        (nextStartOffset !== null &&
            nextStartOffset !== undefined &&
            nextEndOffset !== null &&
            nextEndOffset !== undefined &&
            nextEndOffset < nextStartOffset)
    ) {
        throw new HttpError(
            400,
            "Invalid offsets. start_offset/end_offset must be >= 0 and end_offset >= start_offset."
        );
    }

    if (
        (body.selected_text !== undefined && body.selected_text !== null && typeof body.selected_text !== "string") ||
        (body.raw_selected_text !== undefined &&
            body.raw_selected_text !== null &&
            typeof body.raw_selected_text !== "string") ||
        (body.formatted_selected_text !== undefined &&
            body.formatted_selected_text !== null &&
            typeof body.formatted_selected_text !== "string") ||
        (body.context_prefix !== undefined &&
            body.context_prefix !== null &&
            typeof body.context_prefix !== "string") ||
        (body.context_suffix !== undefined &&
            body.context_suffix !== null &&
            typeof body.context_suffix !== "string")
    ) {
        throw new HttpError(
            400,
            "Invalid body. Text fields must be strings when provided (or null where supported)."
        );
    }

    const tagsNorm = body.tags === undefined ? undefined : normalizeTags(body.tags);
    if (tagsNorm === "__INVALID__") {
        throw new HttpError(
            400,
            "Invalid body. tags must be an array of strings or comma-separated string."
        );
    }

    const anchorGeometryNorm =
        body.anchor_geometry === undefined ? undefined : normalizeAnchorGeometry(body.anchor_geometry);
    if (anchorGeometryNorm === "__INVALID__") {
        throw new HttpError(400, "Invalid body. anchor_geometry must be a JSON array when provided.");
    }

    const nextRawSelectedText =
        body.raw_selected_text === undefined
            ? existingRow.raw_selected_text
            : body.raw_selected_text === null
                ? ""
                : body.raw_selected_text;
    const nextFormattedSelectedText =
        body.formatted_selected_text === undefined
            ? existingRow.formatted_selected_text
            : body.formatted_selected_text;
    const selectedTextCandidate =
        body.selected_text === undefined
            ? existingRow.selected_text
            : body.selected_text === null
                ? ""
                : body.selected_text;
    const nextSelectedText =
        typeof selectedTextCandidate === "string" && selectedTextCandidate.trim()
            ? selectedTextCandidate
            : typeof nextFormattedSelectedText === "string" && nextFormattedSelectedText.trim()
                ? nextFormattedSelectedText
                : nextRawSelectedText;

    if (!nextRawSelectedText.trim()) {
        throw new HttpError(400, "raw_selected_text must remain a non-empty string.");
    }

    return {
        startTime: nextStartTime,
        endTime: nextEndTime,
        pageStart: nextPageStart ?? null,
        pageEnd: nextPageEnd ?? null,
        selectedText: nextSelectedText,
        rawSelectedText: nextRawSelectedText,
        formattedSelectedText: nextFormattedSelectedText ?? null,
        contextPrefix: body.context_prefix === undefined ? existingRow.context_prefix : body.context_prefix,
        contextSuffix: body.context_suffix === undefined ? existingRow.context_suffix : body.context_suffix,
        startOffset: nextStartOffset ?? null,
        endOffset: nextEndOffset ?? null,
        tags: tagsNorm === undefined ? existingRow.tags : tagsNorm,
        anchorGeometry: anchorGeometryNorm === undefined ? existingRow.anchor_geometry : anchorGeometryNorm,
    };
}

export async function createScriptScene(pool, { movieId, scriptId, body }) {
    const input = buildCreateInput(body);

    const script = await findScriptForMovie(pool, { movieId, scriptId });
    if (!script) throw new HttpError(404, "Script not found");

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const conflictingRow = await repository.findOverlappingScriptScene(client, {
            movieId,
            scriptId,
            startTimeSeconds: input.startTime,
            endTimeSeconds: input.endTime,
        });
        if (conflictingRow) {
            await client.query("ROLLBACK");
            throw conflictError(conflictingRow);
        }

        const anchorId = uuidv4();
        const sceneId = uuidv4();

        await repository.insertScriptSceneAnchor(client, {
            anchorId,
            movieId,
            scriptId,
            pageStart: input.pageStart,
            pageEnd: input.pageEnd,
            selectedText: input.selectedText,
            rawSelectedText: input.rawSelectedText,
            formattedSelectedText: input.formattedSelectedText,
            contextPrefix: input.contextPrefix,
            contextSuffix: input.contextSuffix,
            startOffset: input.startOffset,
            endOffset: input.endOffset,
            anchorGeometry: input.anchorGeometry,
        });

        await repository.insertScriptSceneAnnotation(client, {
            sceneId,
            anchorId,
            movieId,
            scriptId,
            startTimeSeconds: input.startTime,
            endTimeSeconds: input.endTime,
            tags: input.tags,
        });

        const createdRow = await repository.fetchScriptSceneRow(client, { sceneId, movieId, scriptId });
        await client.query("COMMIT");
        return mapScriptSceneRow(createdRow);
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch {
            // Ignore rollback failures; the original error is more useful.
        }
        throw err;
    } finally {
        client.release();
    }
}

export async function listScriptScenes(db, { movieId, scriptId }) {
    const rows = await repository.listScriptSceneRows(db, { movieId, scriptId });
    return rows.map(mapScriptSceneRow);
}

export async function updateScriptScene(pool, { movieId, scriptId, sceneId, body }) {
    if (!sceneId) throw new HttpError(400, "Missing scene annotation id.");

    const existingRow = await repository.fetchScriptSceneRow(pool, { sceneId, movieId, scriptId });
    if (!existingRow) throw new HttpError(404, "Script scene annotation not found");

    const input = buildUpdateInput(existingRow, body || {});

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const conflictingRow = await repository.findOverlappingScriptScene(client, {
            movieId,
            scriptId,
            startTimeSeconds: input.startTime,
            endTimeSeconds: input.endTime,
            excludeSceneId: sceneId,
        });
        if (conflictingRow) {
            await client.query("ROLLBACK");
            throw conflictError(conflictingRow);
        }

        await repository.updateScriptSceneAnchor(client, {
            anchorId: existingRow.anchor_id,
            pageStart: input.pageStart,
            pageEnd: input.pageEnd,
            selectedText: input.selectedText,
            rawSelectedText: input.rawSelectedText,
            formattedSelectedText: input.formattedSelectedText,
            contextPrefix: input.contextPrefix ?? null,
            contextSuffix: input.contextSuffix ?? null,
            startOffset: input.startOffset,
            endOffset: input.endOffset,
            anchorGeometry: Array.isArray(input.anchorGeometry) ? input.anchorGeometry : [],
        });

        await repository.updateScriptSceneAnnotation(client, {
            sceneId,
            startTimeSeconds: input.startTime,
            endTimeSeconds: input.endTime,
            tags: Array.isArray(input.tags) ? input.tags : [],
        });

        const updatedRow = await repository.fetchScriptSceneRow(client, { sceneId, movieId, scriptId });
        await client.query("COMMIT");
        return mapScriptSceneRow(updatedRow);
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch {
            // Ignore rollback failures; the original error is more useful.
        }
        throw err;
    } finally {
        client.release();
    }
}

export async function deleteScriptScene(db, { movieId, scriptId, sceneId }) {
    if (!sceneId) throw new HttpError(400, "Missing scene annotation id.");

    const deleted = await repository.deleteScriptSceneRow(db, { movieId, scriptId, sceneId });
    if (!deleted) throw new HttpError(404, "Script scene annotation not found");
}

export async function searchScriptScenes(db, { rawTags, match }) {
    const tagsNorm = normalizeTags(rawTags);
    if (tagsNorm === "__INVALID__") throw new HttpError(400, "Invalid tags query parameter.");

    const rows = await repository.searchScriptSceneRows(db, { tags: tagsNorm, match });
    return rows.map(mapScriptSceneRow);
}
