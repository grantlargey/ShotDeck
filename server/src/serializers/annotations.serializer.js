import { createPresignedGetUrl } from "../s3.js";

export async function withAnnotationImageUrl(row) {
    if (!row) return row;
    if (!row.image_key) return { ...row, image_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: row.image_key });
        return { ...row, image_url: url };
    } catch (err) {
        console.error("Failed to sign annotation image URL:", row.image_key, err?.message);
        return { ...row, image_url: null };
    }
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
        created_at: row.created_at,
    };
}
