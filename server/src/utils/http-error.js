/**
 * Lightweight application error used by services to describe HTTP outcomes
 * without importing Express or knowing about response objects. The message and
 * details are sent to the client, so never include internals in them.
 */
export class HttpError extends Error {
    constructor(status, message, details = {}) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        Object.assign(this, details);
    }
}
