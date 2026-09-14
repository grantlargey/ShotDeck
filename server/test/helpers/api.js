import "./guard.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { app } from "../../src/app.js";
import { pool } from "../../src/db.js";
import { createOwner } from "../../src/services/auth.service.js";
import { hashPassword } from "../../src/utils/passwords.js";

/*
 * Drives the real Express app over HTTP. Each test file calls startApi() once;
 * the files share one database, so tests make their own records and never
 * assume a table holds only what they created.
 */

export const ALLOWED_ORIGIN = "http://localhost:5173";

function parseJson(text) {
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function createClient(baseUrl) {
    /**
     * `body` is sent as JSON; `rawBody` is sent as it is, with a JSON content type
     * unless `headers` names another. The result's `body` is the parsed JSON, if any.
     */
    async function request(method, path, { body, rawBody, cookie, origin, headers = {} } = {}) {
        const init = { method, headers: { ...headers }, redirect: "manual" };
        if (cookie) init.headers.cookie = cookie;
        if (origin) init.headers.origin = origin;
        if (body !== undefined || rawBody !== undefined) {
            init.headers["content-type"] ??= "application/json";
            init.body = rawBody ?? JSON.stringify(body);
        }
        const response = await fetch(`${baseUrl}${path}`, init);
        const text = await response.text();
        return { status: response.status, headers: response.headers, text, body: parseJson(text) };
    }

    return {
        request,
        get: (path, options) => request("GET", path, options),
        post: (path, options) => request("POST", path, options),
        put: (path, options) => request("PUT", path, options),
        delete: (path, options) => request("DELETE", path, options),
    };
}

/** Starts the app on a free port, and stops it and closes the database pool when the file's tests end. */
export async function startApi() {
    const server = await new Promise((resolve, reject) => {
        const listener = app.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve(listener)));
    });
    after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await pool.end();
    });
    return createClient(`http://127.0.0.1:${server.address().port}`);
}

export function uniqueEmail(label = "admin") {
    return `${label}-${randomUUID()}@example.com`;
}

/** An owner account, created the way the admin CLI creates one. */
export async function createOwnerAccount({ email = uniqueEmail("owner"), password = "owner-password-123" } = {}) {
    const user = await createOwner(pool, { email, passwordHash: await hashPassword(password) });
    return { user, email, password };
}

/** The `name=value` part of the session cookie a response sets, or null. */
export function sessionCookieFrom(response) {
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("sd_admin="));
    return cookie ? cookie.split(";")[0] : null;
}

export async function signIn(api, { email, password }, { headers } = {}) {
    const response = await api.post("/auth/login", { body: { email, password }, headers });
    assert.equal(response.status, 200, response.text);
    return sessionCookieFrom(response);
}

/** A new owner account, signed in over HTTP. */
export async function signInOwner(api) {
    const account = await createOwnerAccount();
    return { ...account, cookie: await signIn(api, account) };
}
