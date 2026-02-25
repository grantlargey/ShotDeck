// server/src/s3.js
import "dotenv/config";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

if (!region || !bucket) {
  console.warn("Missing AWS_REGION or S3_BUCKET in server/.env");
}

export const s3 = new S3Client({ region });

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

export async function createPresignedGetUrl({ key }) {
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("AWS_REGION is not set");
  if (!key) throw new Error("key is required");

  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { url };
}

// Back-compat helper if you use it elsewhere
export async function signGetUrlForKey(key, expiresIn = 300) {
  if (!bucket) throw new Error("S3_BUCKET is not set");
  if (!region) throw new Error("AWS_REGION is not set");
  if (!key) return null;

  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(s3, cmd, { expiresIn });
}

// Optional: only valid if your bucket/object is publicly readable OR you use CloudFront
export function buildPublicUrlForKey(key) {
  if (!key) return null;

  const cfBase = process.env.CLOUDFRONT_IMAGE_BASE_URL;
  if (cfBase) return `${cfBase.replace(/\/$/, "")}/${key}`;

  // Virtual-hosted–style URL
  const b = process.env.S3_BUCKET;
  const r = process.env.AWS_REGION;

  // Note: us-east-1 has a slightly different legacy endpoint too,
  // but this format works for most modern buckets.
  return `https://${b}.s3.${r}.amazonaws.com/${key}`;
}