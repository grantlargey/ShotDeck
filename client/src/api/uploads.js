// client/src/api/uploads.js
const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ||
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

async function fetchApi(path, options) {
  try {
    return await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error(
      `Network error calling ${API_BASE}${path}. Check VITE_API_BASE, HTTPS, and CORS.`
    );
  }
}

export async function presignUpload({ movieId, type, contentType }) {
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
