// client/src/shared/api/uploads.js
import { API_BASE } from "./request.js";

async function fetchApi(path, options) {
  try {
    return await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error(
      `Network error calling ${API_BASE}${path}. Check VITE_API_BASE, HTTPS, and CORS.`
    );
  }
}

async function presignUpload({ movieId, type, contentType }) {
  // Basic client-side guardrails
  if (!movieId) throw new Error("presignUpload: movieId is required");
  if (type !== "cover" && type !== "annotation" && type !== "script") {
    throw new Error('presignUpload: type must be "cover", "annotation", or "script"');
  }
  if (typeof contentType !== "string") {
    throw new Error("presignUpload: contentType is required");
  }
  if ((type === "cover" || type === "annotation") && !contentType.startsWith("image/")) {
    throw new Error("presignUpload: image uploads require image/* mime type");
  }
  if (type === "script" && contentType !== "application/pdf") {
    throw new Error("presignUpload: script uploads require application/pdf");
  }

  const res = await fetchApi("/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      movieId: String(movieId),
      type,
      contentType, // IMPORTANT: send exact mime type (image/jpeg, image/png, etc.)
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to presign upload (${res.status}): ${text}`);
  }

  return res.json();
}

async function uploadToS3(uploadUrl, file) {
  if (!uploadUrl) throw new Error("uploadToS3: uploadUrl is required");
  if (!file) throw new Error("uploadToS3: file is required");

  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      // MUST match the ContentType used when generating the presigned URL
      "Content-Type": file.type || "application/octet-stream",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 upload failed (${res.status}): ${text}`);
  }
}

/**
 * Higher-level direct-to-S3 upload helper used by feature actions.
 * Returns the stable object key that should be saved in the database.
 */
export async function uploadMediaFile({ movieId, type, file }) {
  if (!file) throw new Error("Please choose a file to upload.");

  const { uploadUrl, key } = await presignUpload({
    movieId,
    type,
    contentType: file.type,
  });

  await uploadToS3(uploadUrl, file);
  return key;
}

/**
 * Shared validation for the app's script upload controls.
 */
export function assertPdfFile(file) {
  if (file && file.type !== "application/pdf") {
    throw new Error("Please choose a PDF file.");
  }
}
