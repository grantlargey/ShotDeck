import { ApiError } from "@/shared/lib/errors";

export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ||
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

/**
 * Shared HTTP primitive for the ShotDeck REST API.
 *
 * Domain API modules build endpoint-specific functions on top of this helper,
 * which keeps response parsing consistent across the app. Failures throw an
 * ApiError whose message is for the console; UI text comes from
 * getErrorMessage().
 */
export async function req(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (cause) {
    throw new ApiError(`Network error calling ${url}. Check VITE_API_BASE, HTTPS, and CORS.`, {
      url,
      cause,
    });
  }

  const text = await res.text();

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    throw new ApiError(`${opts.method || "GET"} ${url} failed: ${res.status} ${res.statusText}`, {
      status: res.status,
      url,
      body: data,
    });
  }

  return data;
}
