// client/src/api/uploads.js
const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:4000";

export async function presignUpload({ movieId, type, contentType }) {
  const res = await fetch(`${API_BASE}/uploads/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ movieId, type, contentType }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || "Failed to presign upload");
  }
  return data; // { uploadUrl, key, publicUrl }
}

export async function uploadToS3(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });

  if (!res.ok) {
    throw new Error(`S3 upload failed (${res.status})`);
  }
}