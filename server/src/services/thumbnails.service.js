import path from "path";
import sharp from "sharp";
import { getObjectBytes, putObjectToS3 } from "../s3.js";

/**
 * Small WebP copies of film stills for the stills grid, timeline previews, and
 * scene cards. The hero and the scene viewer keep the full image.
 *
 * Thumbnails are made in the background, one at a time, so the API keeps
 * answering while it works through a backlog. Until a still's thumbnail is
 * ready, clients show its full image.
 */

// Grid tiles are usually 240-400 CSS px wide, so this stays sharp on 2x screens.
const THUMBNAIL_WIDTH = 800;
const THUMBNAIL_QUALITY = 75;
// After a failure, an image waits this long before it's tried again.
const RETRY_AFTER_MS = 60 * 60 * 1000;

// One libvips thread and no operation cache, to share a small API task's CPU and memory.
sharp.concurrency(1);
sharp.cache(false);

const pendingImageKeys = new Set();
const failedAt = new Map();
let draining = false;

/** A thumbnail lives in a `thumbs/` folder beside its image, under the same key prefix. */
function getThumbnailKey(imageKey) {
    const { dir, base } = path.posix.parse(imageKey);
    return path.posix.join(dir, "thumbs", `${base}.webp`);
}

async function createThumbnail(db, imageKey) {
    const image = await getObjectBytes(imageKey);
    const thumbnail = await sharp(image)
        .rotate()
        .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toBuffer();

    const thumbKey = getThumbnailKey(imageKey);
    await putObjectToS3({
        key: thumbKey,
        contentType: "image/webp",
        body: thumbnail,
        cacheControl: "max-age=86400",
    });
    // Only stills still showing this image take the thumbnail, so a replaced image never gets a stale one.
    await db.query(
        `
        UPDATE annotations
        SET thumb_key = $2
        WHERE image_key = $1
          AND thumb_key IS DISTINCT FROM $2
      `,
        [imageKey, thumbKey]
    );
}

async function drain(db) {
    draining = true;
    // A Set visits keys added while it's being iterated, so new work joins this pass.
    for (const imageKey of pendingImageKeys) {
        try {
            await createThumbnail(db, imageKey);
            failedAt.delete(imageKey);
        } catch (err) {
            failedAt.set(imageKey, Date.now());
            console.error("Failed to create still thumbnail:", imageKey, err?.message);
        }
        pendingImageKeys.delete(imageKey);
    }
    draining = false;
}

/** Queues thumbnails for these images and returns right away. */
function queueThumbnails(db, imageKeys) {
    const now = Date.now();
    for (const imageKey of imageKeys) {
        if (!imageKey || pendingImageKeys.has(imageKey)) continue;
        const failed = failedAt.get(imageKey);
        if (failed !== undefined && now - failed < RETRY_AFTER_MS) continue;
        pendingImageKeys.add(imageKey);
    }
    if (!draining && pendingImageKeys.size > 0) drain(db);
}

/** Queues thumbnails for still rows whose image doesn't have one yet. */
export function queueThumbnailsForRows(db, rows) {
    // thumb_key is undefined, not null, until the migration that adds it has run.
    const imageKeys = rows.filter((row) => row?.image_key && row.thumb_key === null).map((row) => row.image_key);
    queueThumbnails(db, imageKeys);
}

/** Queues thumbnails for every still that doesn't have one. */
export async function queueMissingThumbnails(db) {
    const result = await db.query(
        `
        SELECT DISTINCT image_key
        FROM annotations
        WHERE COALESCE(image_key, '') <> ''
          AND thumb_key IS NULL
      `
    );
    const imageKeys = result.rows.map((row) => row.image_key);
    if (imageKeys.length > 0) console.log(`Queued ${imageKeys.length} still images for thumbnails`);
    queueThumbnails(db, imageKeys);
}
