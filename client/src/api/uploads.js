// client/src/api/uploads.js
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function presignUpload({ movieId, type, contentType }) {
  // Basic client-side guardrails
  if (!movieId) throw new Error("presignUpload: movieId is required");
  if (type !== "cover" && type !== "annotation") {
    throw new Error('presignUpload: type must be "cover" or "annotation"');
  }
  if (typeof contentType !== "string" || !contentType.startsWith("image/")) {
    throw new Error("presignUpload: contentType must be an image/* mime type");
  }

  const res = await fetch(`${API_BASE}/uploads/presign`, {
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

export async function uploadToS3(uploadUrl, file) {
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