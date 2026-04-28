import { createPresignedGetUrl } from "../s3.js";

/**
 * Adds the short-lived browser URL expected by existing clients while keeping
 * the database row's stable S3 key in the response.
 */
export async function withMovieCoverUrl(movieRow) {
    if (!movieRow) return movieRow;
    if (!movieRow.cover_image_key) return { ...movieRow, cover_image_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: movieRow.cover_image_key });
        return { ...movieRow, cover_image_url: url };
    } catch (err) {
        console.error("Failed to sign movie cover URL:", movieRow.cover_image_key, err?.message);
        return { ...movieRow, cover_image_url: null };
    }
}
