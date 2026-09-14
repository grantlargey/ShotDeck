import { ApiError } from "@/shared/lib/errors.js";

export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ||
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

/** Fired on `window` when the API refuses a request that needed the admin session that was active. */
export const SESSION_EXPIRED_EVENT = "scriptdeck:session-expired";
const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to save your changes.";

let sessionActive = false;

/**
 * The session context reports whether an admin is signed in, so a 401 from a
 * write can be shown as an expired session rather than a generic failure.
 */
export function markSessionActive(active) {
  sessionActive = Boolean(active);
}

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
    // The admin session cookie rides along on every call; visitors have none.
    res = await fetch(url, { credentials: "include", ...opts });
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
    // A wrong password is a 401 too, but it doesn't mean the session went away.
    if (res.status === 401 && sessionActive && path !== "/auth/login") {
      sessionActive = false;
      data = { ...(data && typeof data === "object" ? data : {}), error: SESSION_EXPIRED_MESSAGE };
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(`${opts.method || "GET"} ${url} failed: ${res.status} ${res.statusText}`, {
      status: res.status,
      url,
      body: data,
    });
  }

  return data;
}
