import { v4 as uuidv4 } from "uuid";
import {
    buildObjectKey,
    createPresignedPutUrl,
    createPresignedGetUrl,
    getExtensionForContentType,
} from "../s3.js";
import { HttpError } from "../utils/http-error.js";

export async function createUploadPresign({ movieId, type, contentType }) {
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

    const id = uuidv4();
    const ext = getExtensionForContentType(contentType);
    const key = buildObjectKey({
        movieId,
        type,
        filename: `${id}.${ext}`,
    });

    const { uploadUrl } = await createPresignedPutUrl({ key, contentType });
    return { uploadUrl, key };
}

export async function createViewUrl(key) {
    if (typeof key !== "string" || key.length < 3) {
        throw new HttpError(400, "Missing or invalid key");
    }

    if (!key.startsWith("covers/") && !key.startsWith("annotations/") && !key.startsWith("scripts/")) {
        throw new HttpError(400, "Invalid key prefix");
    }

    const { url } = await createPresignedGetUrl({ key });
    return { url };
}
