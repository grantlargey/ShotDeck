import { HttpError } from "../utils/http-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses data-changing requests that a browser sends on behalf of another
 * site. Browsers always add an Origin header to cross-origin requests, so a
 * request from a page that isn't ours is rejected before any route runs.
 * Requests without an Origin (curl, the import script) pass and are still
 * subject to the session check.
 */
export function createOriginCheck(allowedOrigins) {
    return function checkOrigin(req, res, next) {
        if (SAFE_METHODS.has(req.method)) return next();
        const origin = req.headers.origin;
        if (origin && !allowedOrigins.has(origin)) {
            return next(new HttpError(403, "This request came from a site that isn't allowed to change data."));
        }
        return next();
    };
}
