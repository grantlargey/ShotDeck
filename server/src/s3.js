// server/src/s3.js
import "./env.js";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl, S3RequestPresigner } from "@aws-sdk/s3-request-presigner";
import { formatUrl } from "@aws-sdk/util-format-url";

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

// A custom endpoint points this module at an S3-compatible service instead of
// AWS, which is how local development runs media without an AWS account.
//
// The endpoint the API sends to and the one the browser opens can differ: a
// containerized API reaches the service over the Compose network, while the
// browser reaches its published port. S3_PUBLIC_ENDPOINT names the second one
// when they differ; otherwise both are the same.
const endpoint = process.env.AWS_ENDPOINT_URL_S3 || process.env.AWS_ENDPOINT_URL || null;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint;

if (!region || !bucket) {
  console.warn("Missing AWS_REGION or S3_BUCKET in server/.env");
}

// Path-style addressing puts the bucket in the path rather than the hostname,
// which is what S3-compatible services on a host or container name expect.
const s3 = new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });

// Presigned URLs are opened by the browser, so they are signed against the
// public endpoint. It is usually the same client.
const signingClient =
  publicEndpoint === endpoint
    ? s3
    : new S3Client({ region, endpoint: publicEndpoint, forcePathStyle: true });

// Where a signed view URL points. AWS keeps its virtual-hosted bucket hostname.
const viewUrlTarget = publicEndpoint
  ? { ...pickOrigin(publicEndpoint), prefix: `/${bucket}` }
  : { protocol: "https:", hostname: `${bucket}.s3.${region}.amazonaws.com`, prefix: "" };

/** The protocol and host (including any port) of an endpoint URL. */
function pickOrigin(value) {
  const { protocol, host } = new URL(value);
  return { protocol, hostname: host };
}

// View URLs are signed from the start of a fixed window, so a key keeps the same
// URL for the whole window: browsers reuse cached images and the API skips
// re-signing. A URL lasts two windows, so one handed out at the very end of its
// window still has a whole window of life left, and whoever holds it can tell
// from the expiry it comes with when it has to be replaced.
const VIEW_URL_WINDOW_MS = 60 * 60 * 1000;
const VIEW_URL_LIFETIME_MS = 2 * VIEW_URL_WINDOW_MS;

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

  const uploadUrl = await getSignedUrl(signingClient, cmd, { expiresIn: 300 });
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

/**
 * A URL for reading a key, and the moment it stops working. Both follow from the
 * window the call falls in, so every caller asking for a key during one window is
 * handed the same pair, and none of them has to guess how long it lasts.
 */
export async function createPresignedGetUrl({ key }) {
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("AWS_REGION is not set");
  if (!key) throw new Error("key is required");

  const windowStart = Math.floor(Date.now() / VIEW_URL_WINDOW_MS) * VIEW_URL_WINDOW_MS;
  if (viewUrlCache.windowStart !== windowStart) {
    viewUrlCache.windowStart = windowStart;
    viewUrlCache.urls.clear();
  }
  const expiresAt = new Date(windowStart + VIEW_URL_LIFETIME_MS);

  const cached = viewUrlCache.urls.get(key);
  if (cached) return { url: cached, expiresAt };

  const { protocol, hostname, prefix } = viewUrlTarget;
  const signed = await viewUrlPresigner.presign(
    { method: "GET", protocol, hostname, path: `${prefix}/${encodeKeyPath(key)}`, query: {}, headers: {} },
    { expiresIn: VIEW_URL_LIFETIME_MS / 1000, signingDate: new Date(windowStart) }
  );
  const url = formatUrl(signed);
  if (viewUrlCache.windowStart === windowStart) viewUrlCache.urls.set(key, url);
  return { url, expiresAt };
}

/**
 * The view URL a record's response carries for one of its keys: the pair from
 * createPresignedGetUrl, or a pair of nulls when the record holds no key or the
 * signing fails.
 *
 * A record is still worth answering with when one of its images can't be signed,
 * so the failure is logged here and the response goes out with a null URL. The
 * on-demand endpoint takes the other line: there the URL is the whole answer, so
 * it signs through createPresignedGetUrl and lets the failure become a 500. The
 * key names what failed, and its folder says whether it was a cover, a still or a
 * script.
 */
export async function signViewUrl(key) {
  if (!key) return { url: null, expiresAt: null };

  try {
    return await createPresignedGetUrl({ key });
  } catch (err) {
    console.error("Failed to sign a view URL:", key, err?.message);
    return { url: null, expiresAt: null };
  }
}
