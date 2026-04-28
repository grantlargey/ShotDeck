/**
 * Lightweight application error used by services to describe HTTP outcomes
 * without importing Express or knowing about response objects.
 */
export class HttpError extends Error {
    constructor(status, message, details = {}) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        Object.assign(this, details);
    }
}

export function isHttpError(err) {
    return err instanceof HttpError || (err && Number.isInteger(err.status));
}
