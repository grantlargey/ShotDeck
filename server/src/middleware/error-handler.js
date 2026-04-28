import { isHttpError } from "../utils/http-error.js";

/**
 * Final Express error boundary.
 *
 * Controllers still catch selected errors when the legacy response body was
 * route-specific. This handler covers truly unexpected failures and service
 * errors represented as HttpError.
 */
export function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    if (isHttpError(err)) {
        const body = { error: err.message };
        for (const key of Object.keys(err)) {
            if (!["name", "status"].includes(key)) body[key] = err[key];
        }
        return res.status(err.status).json(body);
    }

    console.error(`${req.method} ${req.originalUrl} error:`, err);
    return res.status(500).json({ error: "Internal server error" });
}
