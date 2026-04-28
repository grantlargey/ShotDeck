import { annotationsApi } from "./annotations.js";
import { annotationFormatApi } from "./annotationFormat.js";
import { moviesApi } from "./movies.js";
import { scriptsApi } from "./scripts.js";
import { scriptScenesApi } from "./scriptScenes.js";
import { viewUrlsApi } from "./viewUrls.js";

/**
 * Backward-compatible facade used by page slices.
 *
 * Endpoint implementations are split by backend domain so the REST contract is
 * easier to scan and maintain, while callers can keep using `api.method()`.
 */
export const api = {
  ...annotationFormatApi,
  ...moviesApi,
  ...annotationsApi,
  ...scriptsApi,
  ...scriptScenesApi,
  ...viewUrlsApi,
};
