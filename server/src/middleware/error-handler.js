import { HttpError } from "../utils/http-error.js";

/**
 * The API's single error boundary. Express 5 forwards errors thrown or rejected
 * by async route handlers here, so handlers don't catch them themselves.
 *
 * Response contract (the client's getErrorMessage() relies on it):
 * - HttpError: its status and `{ error: message, ...details }`.
 * - Request parsing failures from Express middleware: their 4xx status with a
 *   fixed message, never parser internals or the echoed request body.
 * - Anything else: logged here, then a generic 500 with no internal details.
 */
export function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    if (err instanceof HttpError) {
        const body = { error: err.message };
        for (const key of Object.keys(err)) {
            if (key !== "name" && key !== "status") body[key] = err[key];
        }
        return res.status(err.status).json(body);
    }

    if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
        console.warn(`${req.method} ${req.originalUrl} rejected:`, err.message);
        const error =
            err.status === 413
                ? "The request is too large. Try a smaller selection or file."
                : "The request could not be read.";
        return res.status(err.status).json({ error });
    }

    console.error(`${req.method} ${req.originalUrl} error:`, err);
    return res.status(500).json({ error: "Something went wrong on the server." });
}
