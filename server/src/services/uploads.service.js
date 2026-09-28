import { v4 as uuidv4, validate as isUuid } from "uuid";
import { createPresignedPutUrl, createPresignedGetUrl } from "../s3.js";
import { HttpError } from "../utils/http-error.js";

const UPLOAD_FOLDERS = {
    cover: "covers",
    annotation: "annotations",
    script: "scripts",
};

const CONTENT_TYPE_EXTENSIONS = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/avif": "avif",
};

/** Validates an upload, chooses its stable object key, and signs a PUT for it. */
export async function createUploadPresign(body) {
    const { movieId, type, contentType, uploadId } = body ?? {};
    const isImageUpload = type === "cover" || type === "annotation";
    const isScriptUpload = type === "script";

    if (
        typeof movieId !== "string" ||
        (!isImageUpload && !isScriptUpload) ||
        typeof contentType !== "string" ||
        (isImageUpload && !contentType.startsWith("image/")) ||
        (isScriptUpload && contentType !== "application/pdf")
    ) {
        throw new HttpError(
            400,
            'Invalid body. Expected { movieId:string, type:"cover"|"annotation"|"script", contentType:"image/*"| "application/pdf" }'
        );
    }

    if (uploadId !== undefined && !isUuid(uploadId)) {
        throw new HttpError(400, "Invalid upload id. Expected a UUID.");
    }
    // Renewing a failed/expired upload targets the same object, including when
    // its previous PUT succeeded but the browser lost the response.
    const id = uploadId ?? uuidv4();
    // Other image/* types are accepted and keep the existing jpg fallback.
    const extension = CONTENT_TYPE_EXTENSIONS[contentType] ?? "jpg";

    if (!movieId) throw new Error("movieId is required");
    const movieSegment = movieId
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!movieSegment) throw new Error("movieId is invalid");

    // The filename consists only of a generated or validated UUID and a known extension.
    const key = `${UPLOAD_FOLDERS[type]}/${movieSegment}/${id}.${extension}`;

    const { uploadUrl } = await createPresignedPutUrl({ key, contentType });
    return { uploadUrl, key };
}

/**
 * The public on-demand view URL for one stored key: a URL and the moment it stops
 * working, for a caller holding a key the API gave it no URL for. Only the three
 * folders the API writes are viewable this way.
 *
 * Here the URL is the whole answer, so a key that can't be signed fails the
 * request rather than answering with a null URL the way a record's field does.
 */
export async function createViewUrl(key) {
    if (typeof key !== "string" || key.length < 3) {
        throw new HttpError(400, "Missing or invalid key");
    }

    if (!key.startsWith("covers/") && !key.startsWith("annotations/") && !key.startsWith("scripts/")) {
        throw new HttpError(400, "Invalid key prefix");
    }

    return createPresignedGetUrl({ key });
}
