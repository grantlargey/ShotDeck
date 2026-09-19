/**
 * App-wide error conventions.
 *
 * Catch blocks turn errors into UI text with getErrorMessage(error, fallback).
 * Messages written for people (ValidationError, deliberate API responses) pass
 * through; everything else shows the caller's fallback, and the technical
 * details go to the console instead of the page.
 */

const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";

/** A problem the user can fix, such as a malformed timestamp. Shown as-is. */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * A failed HTTP request. `status` is 0 when no response arrived (offline, a
 * wrong API base URL, or a CORS block). `body` is the parsed response body.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, url = "", body = null, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

// The API's `error` text is written for people except on these statuses: a 400
// describes the request contract (the client validates user input first, so it
// signals an app bug), and a 500 is deliberately generic.
const INTERNAL_MESSAGE_STATUSES = new Set([400, 500]);

export function getErrorMessage(error, fallback = "Something went wrong. Try again.") {
  if (error instanceof ValidationError) return error.message;

  if (error instanceof ApiError && error.status && !INTERNAL_MESSAGE_STATUSES.has(error.status)) {
    const serverMessage = error.body?.error;
    if (typeof serverMessage === "string" && serverMessage) return serverMessage;
  }

  console.error(error);
  return error instanceof ApiError && error.status === 0 ? NETWORK_ERROR_MESSAGE : fallback;
}
