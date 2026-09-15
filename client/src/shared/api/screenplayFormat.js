import { req } from "./request.js";

/**
 * Asks the server's AI formatter for a screenplay-markdown proposal. The
 * caller reviews the proposal before it replaces any draft text.
 */
export function formatScreenplaySelection(payload) {
  return req("/api/script-scenes/format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
