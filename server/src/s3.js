// server/src/s3.js
import "./env.js";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl, S3RequestPresigner } from "@aws-sdk/s3-request-presigner";
import { formatUrl } from "@aws-sdk/util-format-url";

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

if (!region || !bucket) {
  console.warn("Missing AWS_REGION or S3_BUCKET in server/.env");
}

export const s3 = new S3Client({ region });

// View URLs are signed from the start of a fixed window, so a key keeps the same
// URL for the whole window: browsers reuse cached images and the API skips
// re-signing. Every URL stays valid for at least one window after it's handed out.
const VIEW_URL_WINDOW_MS = 60 * 60 * 1000;
const VIEW_URL_EXPIRES_SECONDS = (2 * VIEW_URL_WINDOW_MS) / 1000;

// One presigner for every view URL. getSignedUrl builds a full command pipeline
// on each call, which made signing a project's stills take seconds.
const viewUrlPresigner = new S3RequestPresigner({
  credentials: s3.config.credentials,
  region: s3.config.region,
  sha256: s3.config.sha256,
});
const viewUrlCache = { windowStart: 0, urls: new Map() };

/** An object key as a URL path: each segment RFC 3986-encoded, slashes kept. */
function encodeKeyPath(key) {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    )
    .join("/");
}

export function getExtensionForContentType(contentType) {
  return contentType === "application/pdf"
    ? "pdf"
    : contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/jpeg"
          ? "jpg"
          : contentType === "image/gif"
            ? "gif"
            : contentType === "image/avif"
              ? "avif"
              : "jpg";
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || "")).trim();
  if (!baseName) throw new Error("filename is required");

  const ext = path.extname(baseName);
  const name = path.basename(baseName, ext);
  const safeName = sanitizePathSegment(name);
  const safeExt = ext ? `.${sanitizePathSegment(ext.slice(1))}` : "";

  if (!safeName) throw new Error("filename is invalid");
  return `${safeName}${safeExt}`;
}

export function buildObjectKey({ movieId, type, filename, namespace = "" }) {
  if (!movieId) throw new Error("movieId is required");
  if (!filename) throw new Error("filename is required");

  const root =
    type === "cover"
      ? "covers"
      : type === "annotation"
        ? "annotations"
        : type === "script"
          ? "scripts"
          : null;

  if (!root) {
    throw new Error('type must be "cover", "annotation", or "script"');
  }

  const movieSegment = sanitizePathSegment(movieId);
  if (!movieSegment) throw new Error("movieId is invalid");

  const namespaceSegments = String(namespace || "")
    .split("/")
    .map(sanitizePathSegment)
    .filter(Boolean);

  return [root, movieSegment, ...namespaceSegments, sanitizeFileName(filename)].join("/");
}

export async function createPresignedPutUrl({ key, contentType }) {
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("AWS_REGION is not set");
  if (!key) throw new Error("key is required");
  if (!contentType) throw new Error("contentType is required");

  // IMPORTANT:
  // If you set ContentType here, the client MUST send the same Content-Type header on PUT.
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
  return { uploadUrl };
}

export async function putObjectToS3({ key, contentType, body, cacheControl }) {
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("AWS_REGION is not set");
  if (!key) throw new Error("key is required");
  if (!contentType) throw new Error("contentType is required");
  if (body === undefined || body === null) throw new Error("body is required");

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    CacheControl: cacheControl,
    Body: body,
  });

  await s3.send(cmd);
  return { key };
}

export async function getObjectBytes(key) {
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("AWS_REGION is not set");
  if (!key) throw new Error("key is required");

  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Body.transformToByteArray();
}

export async function createPresignedGetUrl({ key }) {
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("AWS_REGION is not set");
  if (!key) throw new Error("key is required");

  const windowStart = Math.floor(Date.now() / VIEW_URL_WINDOW_MS) * VIEW_URL_WINDOW_MS;
  if (viewUrlCache.windowStart !== windowStart) {
    viewUrlCache.windowStart = windowStart;
    viewUrlCache.urls.clear();
  }

  const cached = viewUrlCache.urls.get(key);
  if (cached) return { url: cached };

  const hostname = `${bucket}.s3.${region}.amazonaws.com`;
  const signed = await viewUrlPresigner.presign(
    { method: "GET", protocol: "https:", hostname, path: `/${encodeKeyPath(key)}`, query: {}, headers: {} },
    { expiresIn: VIEW_URL_EXPIRES_SECONDS, signingDate: new Date(windowStart) }
  );
  const url = formatUrl(signed);
  if (viewUrlCache.windowStart === windowStart) viewUrlCache.urls.set(key, url);
  return { url };
}
