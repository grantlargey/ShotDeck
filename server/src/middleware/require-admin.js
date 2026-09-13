import { pool } from "../db.js";
import { resolveSessionUser } from "../services/auth.service.js";
import { readSessionToken } from "../utils/cookies.js";
import { HttpError } from "../utils/http-error.js";

/**
 * Resolves the signed-in admin for a request once, from the session cookie.
 * `req.adminUser` is the user row (with `session_token_hash`) or null.
 */
export async function loadAdminUser(req) {
    if (req.adminUser === undefined) {
        req.adminUser = await resolveSessionUser(pool, readSessionToken(req));
    }
    return req.adminUser;
}

/** Guards routes that change data. Visitors get a 401 the client turns into a sign-in prompt. */
export async function requireAdmin(req, res, next) {
    const user = await loadAdminUser(req);
    if (!user) throw new HttpError(401, "Sign in to make changes.");
    next();
}

/** Guards account management. Admins who are not the owner get a 403. */
export async function requireOwner(req, res, next) {
    const user = await loadAdminUser(req);
    if (!user) throw new HttpError(401, "Sign in to make changes.");
    if (user.role !== "owner") throw new HttpError(403, "Only the site owner can manage admin accounts.");
    next();
}
