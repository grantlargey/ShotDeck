import { createHash, randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import * as usersRepository from "../repositories/admin-users.repository.js";
import * as sessionsRepository from "../repositories/admin-sessions.repository.js";
import { SESSION_MAX_AGE_MS } from "../utils/cookies.js";
import { HttpError } from "../utils/http-error.js";
import { clearLoginFailures, loginRetryAfterSeconds, recordLoginFailure } from "../utils/login-limiter.js";
import {
    generateTemporaryPassword,
    hashPassword,
    isPasswordHash,
    passwordProblem,
    verifyPassword,
} from "../utils/passwords.js";

/*
 * Admin accounts and sessions.
 *
 * There is no self-service sign-up. The owner account comes from the admin
 * CLI (createOwner); every other account is created by the owner through the
 * API. A session is a random token in the browser's cookie whose SHA-256 is
 * stored here, so a database read can't be replayed as a session.
 */

// A session is extended by a full window once it has been idle this long, so
// active admins never see it expire and idle ones don't cause a write per request.
const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INCORRECT_CREDENTIALS = "Incorrect email or password.";

// Verified when the email is unknown, so a missing account takes as long as a wrong password.
let decoyHashPromise = null;
function decoyHash() {
    if (!decoyHashPromise) decoyHashPromise = hashPassword(randomBytes(24).toString("base64url"));
    return decoyHashPromise;
}

export function normalizeEmail(value) {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

export function hashSessionToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

function sessionExpiry() {
    return new Date(Date.now() + SESSION_MAX_AGE_MS);
}

async function startSession(db, user) {
    const token = randomBytes(32).toString("base64url");
    await sessionsRepository.createSession(db, {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt: sessionExpiry(),
    });
    return token;
}

// ---------- Sessions ----------

export async function login(db, { email: rawEmail, password, ip }) {
    const email = normalizeEmail(rawEmail);
    if (!email || typeof password !== "string" || !password) {
        throw new HttpError(400, "Invalid body. Expected { email:string, password:string }");
    }

    const limiterKeys = [`email:${email}`, `ip:${ip || "unknown"}`];
    const retryAfter = loginRetryAfterSeconds(limiterKeys);
    if (retryAfter > 0) {
        throw new HttpError(429, `Too many attempts. Try again in ${Math.max(1, Math.ceil(retryAfter / 60))} minutes.`, {
            retry_after_seconds: retryAfter,
        });
    }

    const user = await usersRepository.findAdminUserByEmail(db, email);
    const ok = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, await decoyHash());
    if (!user || !ok) {
        recordLoginFailure(limiterKeys);
        throw new HttpError(401, INCORRECT_CREDENTIALS);
    }
    if (user.disabled_at) {
        throw new HttpError(403, "This account has been disabled.");
    }

    clearLoginFailures(limiterKeys);
    const token = await startSession(db, user);
    await usersRepository.touchAdminLastLogin(db, user.id);
    // Housekeeping that piggybacks on a rare event.
    sessionsRepository.deleteExpiredSessions(db).catch(() => {});

    return { user, token };
}

export async function logout(db, token) {
    if (token) await sessionsRepository.deleteSession(db, hashSessionToken(token));
}

/**
 * The admin behind a cookie token, or null. Disabled accounts resolve to null
 * even with a live session, which is how "disable" signs someone out at once.
 */
export async function resolveSessionUser(db, token) {
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const row = await sessionsRepository.findLiveSessionWithUser(db, tokenHash);
    if (!row || row.disabled_at) return null;

    if (Date.now() - new Date(row.last_seen_at).getTime() > SESSION_REFRESH_AFTER_MS) {
        await sessionsRepository.touchSession(db, { tokenHash, expiresAt: sessionExpiry() });
    }

    const { token_hash: _tokenHash, last_seen_at: _lastSeen, expires_at: _expires, ...user } = row;
    return { ...user, session_token_hash: tokenHash };
}

export async function changeOwnPassword(db, { user, currentPassword, newPassword }) {
    if (typeof currentPassword !== "string" || !currentPassword) {
        throw new HttpError(400, "Enter your current password.");
    }
    const problem = passwordProblem(newPassword);
    if (problem) throw new HttpError(422, problem);

    if (!(await verifyPassword(currentPassword, user.password_hash))) {
        throw new HttpError(403, "Your current password is incorrect.");
    }

    const updated = await usersRepository.updateAdminPassword(db, {
        id: user.id,
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
    });
    // Other browsers signed in with the old password are signed out.
    await sessionsRepository.deleteSessionsForUser(db, { userId: user.id, keepTokenHash: user.session_token_hash });
    return updated;
}

// ---------- Owner-managed accounts ----------

/**
 * A password for a new or reset account. When the owner types one, it is used
 * as-is and the person can keep it. Otherwise a one-time password is generated
 * and the person must choose their own at first sign-in.
 */
async function resolveNewPassword(password) {
    if (password === undefined || password === null || password === "") {
        const temporaryPassword = generateTemporaryPassword();
        return { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, temporaryPassword };
    }
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(422, problem);
    return { passwordHash: await hashPassword(password), mustChangePassword: false, temporaryPassword: null };
}

export function listAdmins(db) {
    return usersRepository.listAdminUsers(db);
}

export async function createAdmin(db, { email: rawEmail, password }) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new HttpError(422, "Enter a valid email address.");
    if (await usersRepository.findAdminUserByEmail(db, email)) {
        throw new HttpError(409, "An admin with that email already exists.");
    }

    const { passwordHash, mustChangePassword, temporaryPassword } = await resolveNewPassword(password);
    const user = await usersRepository.createAdminUser(db, {
        id: uuidv4(),
        email,
        passwordHash,
        role: "admin",
        mustChangePassword,
    });
    return { user, temporaryPassword };
}

async function findManagedAdmin(db, { actor, id }) {
    const target = await usersRepository.findAdminUserById(db, id);
    if (!target) throw new HttpError(404, "Admin not found.");
    if (target.role === "owner" || target.id === actor.id) {
        throw new HttpError(403, "Use the account menu to change your own password.");
    }
    return target;
}

export async function resetAdminPassword(db, { actor, id, password }) {
    const target = await findManagedAdmin(db, { actor, id });
    const { passwordHash, mustChangePassword, temporaryPassword } = await resolveNewPassword(password);
    const user = await usersRepository.updateAdminPassword(db, { id: target.id, passwordHash, mustChangePassword });
    await sessionsRepository.deleteSessionsForUser(db, { userId: target.id });
    return { user, temporaryPassword };
}

export async function setAdminDisabled(db, { actor, id, disabled }) {
    const target = await usersRepository.findAdminUserById(db, id);
    if (!target) throw new HttpError(404, "Admin not found.");
    if (target.role === "owner" || target.id === actor.id) {
        throw new HttpError(403, "The owner account can't be disabled.");
    }

    const user = await usersRepository.setAdminDisabled(db, { id: target.id, disabled });
    if (disabled) await sessionsRepository.deleteSessionsForUser(db, { userId: target.id });
    return user;
}

// ---------- Admin CLI ----------

/** Creates the owner account. The hash is made on the operator's machine so no password crosses the network. */
export async function createOwner(db, { email: rawEmail, passwordHash }) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new Error("A valid email address is required.");
    if (!isPasswordHash(passwordHash)) throw new Error("The password hash is not in the expected scrypt format.");
    if (await usersRepository.findAdminUserByEmail(db, email)) {
        throw new Error(`${email} already exists. Use reset-password to change its password.`);
    }
    return usersRepository.createAdminUser(db, {
        id: uuidv4(),
        email,
        passwordHash,
        role: "owner",
        mustChangePassword: false,
    });
}

export async function resetPasswordByEmail(db, { email: rawEmail, passwordHash }) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new Error("A valid email address is required.");
    if (!isPasswordHash(passwordHash)) throw new Error("The password hash is not in the expected scrypt format.");
    const user = await usersRepository.findAdminUserByEmail(db, email);
    if (!user) throw new Error(`No admin account has the email ${email}.`);

    const updated = await usersRepository.updateAdminPassword(db, { id: user.id, passwordHash, mustChangePassword: false });
    await sessionsRepository.deleteSessionsForUser(db, { userId: user.id });
    return updated;
}
