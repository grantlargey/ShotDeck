export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ||
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

/**
 * Shared HTTP primitive for the ShotDeck REST API.
 *
 * Domain API modules build endpoint-specific functions on top of this helper,
 * which keeps response parsing and error shaping consistent across the app.
 */
export async function req(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch {
    throw new Error(
      `Network error calling ${API_BASE}${path}. Check VITE_API_BASE, HTTPS, and CORS.`
    );
  }

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = contentType.includes("application/json") ? { raw: text } : { raw: text };
    }
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      (data && data.raw) ||
      `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return data;
}
