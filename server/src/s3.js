import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,   // ← ADD THIS
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

if (!region || !bucket) {
  console.warn("Missing AWS_REGION or S3_BUCKET in server/.env");
}

export const s3 = new S3Client({ region });

export async function createPresignedPutUrl({ key, contentType }) {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  // Increase to 5 minutes for dev sanity
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });

  return { uploadUrl };
}

/* 🔥 ADD THIS FUNCTION */
export async function createPresignedGetUrl({ key }) {
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });

  return { url };
}

export function buildPublicUrlForKey(key) {
  const cfBase = process.env.CLOUDFRONT_IMAGE_BASE_URL;
  if (cfBase) return `${cfBase.replace(/\/$/, "")}/${key}`;

  const b = process.env.S3_BUCKET;
  const r = process.env.AWS_REGION;
  return `https://${b}.s3.${r}.amazonaws.com/${key}`;
}