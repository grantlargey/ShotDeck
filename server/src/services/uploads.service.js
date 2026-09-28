import { v4 as uuidv4, validate as isUuid } from "uuid";
import {
    buildObjectKey,
    createPresignedPutUrl,
    createPresignedGetUrl,
    getExtensionForContentType,
} from "../s3.js";
import { HttpError } from "../utils/http-error.js";

/** Reads a presign request, `{ movieId, type, contentType }`, and signs a PUT for a new key in the type's folder. */
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
    const ext = getExtensionForContentType(contentType);
    const key = buildObjectKey({
        movieId,
        type,
        filename: `${id}.${ext}`,
    });

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
