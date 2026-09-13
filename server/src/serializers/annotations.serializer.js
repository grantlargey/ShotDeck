import { createPresignedGetUrl } from "../s3.js";

async function signKey(key) {
    if (!key) return null;

    try {
        const { url } = await createPresignedGetUrl({ key });
        return url;
    } catch (err) {
        console.error("Failed to sign annotation image URL:", key, err?.message);
        return null;
    }
}

/** Adds signed URLs for the still's image and, once it exists, its thumbnail. */
export async function withAnnotationImageUrls(row) {
    if (!row) return row;

    const [imageUrl, thumbUrl] = await Promise.all([signKey(row.image_key), signKey(row.thumb_key)]);
    return { ...row, image_url: imageUrl, thumb_url: thumbUrl };
}

/**
 * Image annotations expose only the fields consumed by the client timeline.
 */
export function mapImageAnnotationRow(row) {
    if (!row) return row;
    return {
        id: row.id,
        movie_id: row.movie_id,
        time_seconds: row.time_seconds,
        image_key: row.image_key,
        image_url: row.image_url ?? null,
        thumb_key: row.thumb_key ?? null,
        thumb_url: row.thumb_url ?? null,
        created_at: row.created_at,
    };
}
