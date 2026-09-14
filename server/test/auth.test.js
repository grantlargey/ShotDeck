import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import {
    ALLOWED_ORIGIN,
    createOwnerAccount,
    sessionCookieFrom,
    signIn,
    signInOwner,
    startApi,
    uniqueEmail,
} from "./helpers/api.js";
import { movieBody } from "./helpers/fixtures.js";
import { pool } from "../src/db.js";

/*
 * Characterization of sign-in, sessions, account management, the sign-in
 * requirement on every data-changing route, and the Origin check.
 */

const api = await startApi();

const USER_FIELDS = ["created_at", "disabled_at", "email", "id", "last_login_at", "must_change_password", "role"];
const SIGN_IN_REQUIRED = { error: "Sign in to make changes." };
const INVALID_LOGIN = "Invalid body. Expected { email:string, password:string }";
const INCORRECT = "Incorrect email or password.";
const TEMPORARY_PASSWORD = /^[a-km-np-zA-HJ-NP-Z2-9]{4}(-[a-km-np-zA-HJ-NP-Z2-9]{4}){3}$/;

// Sign-in failures are counted per email and per client address. Failing
// attempts come from their own address so they never lock out 127.0.0.1.
let lastAddress = 0;
function freshAddress() {
    lastAddress += 1;
    return { "x-forwarded-for": `198.51.100.${lastAddress}` };
}

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

async function currentUser(cookie) {
    const response = await api.get("/auth/me", { cookie });
    assert.equal(response.status, 200);
    return response.body.user;
}

/** An admin created by a signed-in owner, with a password they keep. */
async function createAdmin(owner, { password = "admin-password-123" } = {}) {
    const email = uniqueEmail("admin");
    const response = await api.post("/auth/admins", { cookie: owner.cookie, body: { email, password } });
    assert.equal(response.status, 201, response.text);
    return { user: response.body.user, email, password };
}

describe("signing in", () => {
    test("returns the user and sets a 30-day HttpOnly, SameSite=Lax session cookie", async () => {
        const owner = await createOwnerAccount();
        const response = await api.post("/auth/login", {
            body: { email: `  ${owner.email.toUpperCase()}  `, password: owner.password },
        });

        assert.equal(response.status, 200, response.text);
        assert.deepEqual(Object.keys(response.body), ["user"]);
        const { user } = response.body;
        assert.deepEqual(Object.keys(user).sort(), USER_FIELDS);
        assert.equal(user.id, owner.user.id);
        assert.equal(user.email, owner.email);
        assert.equal(user.role, "owner");
        assert.equal(user.must_change_password, false);
        assert.equal(user.disabled_at, null);
        // The response carries the account as it was before this sign-in was recorded.
        assert.equal(user.last_login_at, null);

        const [cookie] = response.headers.getSetCookie();
        assert.match(cookie, /^sd_admin=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);

        const again = await api.post("/auth/login", { body: { email: owner.email, password: owner.password } });
        assert.ok(!Number.isNaN(Date.parse(again.body.user.last_login_at)));
    });

    test("marks the cookie Secure when the load balancer reports HTTPS", async () => {
        const owner = await createOwnerAccount();
        const response = await api.post("/auth/login", {
            body: { email: owner.email, password: owner.password },
            headers: { "x-forwarded-proto": "https" },
        });
        assert.equal(response.status, 200, response.text);
        assert.match(response.headers.getSetCookie()[0], /; Secure/);
    });

    test("a missing or malformed email or password is a 400", async () => {
        const owner = await createOwnerAccount();
        const invalid = [
            {},
            { email: "not-an-email", password: owner.password },
            { email: owner.email },
            { email: owner.email, password: "" },
            { email: 5, password: owner.password },
        ];
        for (const body of invalid) {
            await expectError(api.post("/auth/login", { body, headers: freshAddress() }), 400, INVALID_LOGIN);
        }
        await expectError(api.post("/auth/login", { headers: freshAddress() }), 400, INVALID_LOGIN);
    });

    test("a wrong password or unknown email is a 401 with one message", async () => {
        const owner = await createOwnerAccount();
        await expectError(
            api.post("/auth/login", { body: { email: owner.email, password: "wrong-password-1" }, headers: freshAddress() }),
            401,
            INCORRECT
        );
        await expectError(
            api.post("/auth/login", { body: { email: uniqueEmail("nobody"), password: owner.password }, headers: freshAddress() }),
            401,
            INCORRECT
        );
    });

    test("after 10 failures for an email, or from an address, sign-in is a 429 for 15 minutes", async () => {
        const owner = await createOwnerAccount();
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const response = await api.post("/auth/login", {
                body: { email: owner.email, password: "wrong-password-1" },
                headers: freshAddress(),
            });
            assert.equal(response.status, 401);
        }
        const byEmail = await api.post("/auth/login", {
            body: { email: owner.email, password: owner.password },
            headers: freshAddress(),
        });
        assert.equal(byEmail.status, 429, byEmail.text);
        assert.equal(byEmail.body.error, "Too many attempts. Try again in 15 minutes.");
        assert.ok(byEmail.body.retry_after_seconds > 890 && byEmail.body.retry_after_seconds <= 900);

        const address = freshAddress();
        for (let attempt = 0; attempt < 10; attempt += 1) {
            await api.post("/auth/login", { body: { email: uniqueEmail("nobody"), password: "wrong-password-1" }, headers: address });
        }
        const other = await createOwnerAccount();
        const byAddress = await api.post("/auth/login", { body: { email: other.email, password: other.password }, headers: address });
        assert.equal(byAddress.status, 429, byAddress.text);
    });

    test("a disabled account is a 403, but only with the right password", async () => {
        const owner = await signInOwner(api);
        const admin = await createAdmin(owner);
        assert.equal((await api.post(`/auth/admins/${admin.user.id}/disable`, { cookie: owner.cookie })).status, 200);

        await expectError(
            api.post("/auth/login", { body: { email: admin.email, password: admin.password }, headers: freshAddress() }),
            403,
            "This account has been disabled."
        );
        await expectError(
            api.post("/auth/login", { body: { email: admin.email, password: "wrong-password-1" }, headers: freshAddress() }),
            401,
            INCORRECT
        );
    });
});

describe("sessions", () => {
    test("GET /auth/me returns null for visitors and unknown cookies, and the user for a session", async () => {
        assert.deepEqual((await api.get("/auth/me")).body, { user: null });
        assert.deepEqual((await api.get("/auth/me", { cookie: "sd_admin=not-a-session" })).body, { user: null });

        const owner = await signInOwner(api);
        const user = await currentUser(owner.cookie);
        assert.deepEqual(Object.keys(user).sort(), USER_FIELDS);
        assert.equal(user.id, owner.user.id);
        assert.ok(!Number.isNaN(Date.parse(user.last_login_at)));
    });

    test("signing out returns 204, clears the cookie and ends the session", async () => {
        const owner = await signInOwner(api);
        const response = await api.post("/auth/logout", { cookie: owner.cookie });

        assert.equal(response.status, 204);
        assert.deepEqual(response.headers.getSetCookie(), [
            "sd_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
        ]);
        assert.equal(await currentUser(owner.cookie), null);
        assert.deepEqual((await api.post("/movies", { cookie: owner.cookie, body: movieBody() })).body, SIGN_IN_REQUIRED);
    });

    test("signing out without a session is also a 204", async () => {
        const response = await api.post("/auth/logout");
        assert.equal(response.status, 204);
    });

    test("an expired session counts as signed out", async () => {
        const owner = await signInOwner(api);
        await pool.query("UPDATE admin_sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1", [owner.user.id]);
        assert.equal(await currentUser(owner.cookie), null);
        await expectError(api.post("/movies", { cookie: owner.cookie, body: movieBody() }), 401, SIGN_IN_REQUIRED.error);
    });
});

describe("data-changing routes", () => {
    const id = randomUUID();
    const MUTATING_ROUTES = [
        ["POST", "/movies"],
        ["PUT", `/movies/${id}`],
        ["DELETE", `/movies/${id}`],
        ["POST", `/movies/${id}/scripts`],
        ["POST", `/movies/${id}/annotations`],
        ["PUT", `/movies/${id}/annotations/${id}`],
        ["DELETE", `/movies/${id}/annotations/${id}`],
        ["POST", `/movies/${id}/scripts/${id}/scene-annotations`],
        ["PUT", `/movies/${id}/scripts/${id}/scene-annotations/${id}`],
        ["DELETE", `/movies/${id}/scripts/${id}/scene-annotations/${id}`],
        ["POST", "/uploads/presign"],
        ["POST", "/api/script-scenes/format"],
        ["POST", "/auth/password"],
        ["GET", "/auth/admins"],
        ["POST", "/auth/admins"],
        ["POST", `/auth/admins/${id}/reset-password`],
        ["POST", `/auth/admins/${id}/disable`],
        ["POST", `/auth/admins/${id}/enable`],
    ];

    test("every one answers 401 when signed out", async () => {
        for (const [method, path] of MUTATING_ROUTES) {
            const response = await api.request(method, path, method === "GET" ? {} : { body: {} });
            assert.equal(response.status, 401, `${method} ${path}`);
            assert.deepEqual(response.body, SIGN_IN_REQUIRED, `${method} ${path}`);
        }
    });

    test("a request from another site's page is a 403 before the sign-in check; reads from it still work", async () => {
        const owner = await signInOwner(api);
        const refused = "This request came from a site that isn't allowed to change data.";
        const origin = "https://elsewhere.example";

        await expectError(api.post("/movies", { origin, body: movieBody() }), 403, refused);
        await expectError(api.post("/movies", { origin, cookie: owner.cookie, body: movieBody() }), 403, refused);
        await expectError(api.delete(`/movies/${randomUUID()}`, { origin, cookie: owner.cookie }), 403, refused);
        await expectError(api.post("/auth/login", { origin, body: { email: owner.email, password: owner.password } }), 403, refused);

        assert.equal((await api.get("/movies", { origin })).status, 200);
        await expectError(api.post("/movies", { origin: ALLOWED_ORIGIN, body: movieBody() }), 401, SIGN_IN_REQUIRED.error);
        assert.equal((await api.post("/movies", { origin: ALLOWED_ORIGIN, cookie: owner.cookie, body: movieBody() })).status, 201);
    });
});

describe("changing your own password", () => {
    test("checks the current password is present, then the new password, then that the current one is right", async () => {
        const owner = await signInOwner(api);
        const change = (body) => api.post("/auth/password", { cookie: owner.cookie, body });

        await expectError(change({ new_password: "a-new-password-1" }), 400, "Enter your current password.");
        await expectError(change({ current_password: "", new_password: "short" }), 400, "Enter your current password.");
        await expectError(change({ current_password: "wrong-password-1" }), 422, "Enter a password.");
        await expectError(change({ current_password: "wrong-password-1", new_password: "short" }), 422, "Use at least 12 characters.");
        await expectError(change({ current_password: owner.password, new_password: "x".repeat(201) }), 422, "Use at most 200 characters.");
        await expectError(change({ current_password: "wrong-password-1", new_password: "a-new-password-1" }), 403, "Your current password is incorrect.");
    });

    test("returns the user, keeps this session and signs out every other one", async () => {
        const owner = await signInOwner(api);
        const otherSession = await signIn(api, owner);
        const response = await api.post("/auth/password", {
            cookie: owner.cookie,
            body: { current_password: owner.password, new_password: "a-new-password-1" },
        });

        assert.equal(response.status, 200, response.text);
        assert.deepEqual(Object.keys(response.body), ["user"]);
        assert.equal(response.body.user.must_change_password, false);
        assert.equal((await currentUser(owner.cookie)).id, owner.user.id);
        assert.equal(await currentUser(otherSession), null);

        await expectError(
            api.post("/auth/login", { body: { email: owner.email, password: owner.password }, headers: freshAddress() }),
            401,
            INCORRECT
        );
        assert.ok(await signIn(api, { email: owner.email, password: "a-new-password-1" }));
    });
});

describe("managing admin accounts", () => {
    test("is for the owner only: an admin gets a 403", async () => {
        const owner = await signInOwner(api);
        const admin = await createAdmin(owner);
        const adminCookie = await signIn(api, admin);
        const ownerOnly = "Only the site owner can manage admin accounts.";

        await expectError(api.get("/auth/admins", { cookie: adminCookie }), 403, ownerOnly);
        await expectError(api.post("/auth/admins", { cookie: adminCookie, body: { email: uniqueEmail() } }), 403, ownerOnly);
        for (const action of ["reset-password", "disable", "enable"]) {
            await expectError(api.post(`/auth/admins/${owner.user.id}/${action}`, { cookie: adminCookie }), 403, ownerOnly);
        }
        // An admin can still change data.
        assert.equal((await api.post("/movies", { cookie: adminCookie, body: movieBody() })).status, 201);
    });

    test("GET /auth/admins lists owners first, then admins oldest first, without password details", async () => {
        const owner = await signInOwner(api);
        const first = await createAdmin(owner);
        const second = await createAdmin(owner);

        const response = await api.get("/auth/admins", { cookie: owner.cookie });
        assert.equal(response.status, 200);
        for (const user of response.body) assert.deepEqual(Object.keys(user).sort(), USER_FIELDS);
        const roles = response.body.map((user) => user.role);
        assert.equal(roles.lastIndexOf("owner") < roles.indexOf("admin"), true);
        const ids = response.body.map((user) => user.id);
        assert.ok(ids.includes(owner.user.id));
        assert.ok(ids.indexOf(first.user.id) < ids.indexOf(second.user.id));
    });

    test("creating an admin without a password returns a temporary one that must be changed", async () => {
        const owner = await signInOwner(api);
        const email = uniqueEmail("temp");
        const response = await api.post("/auth/admins", { cookie: owner.cookie, body: { email: `  ${email.toUpperCase()} ` } });

        assert.equal(response.status, 201, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), ["temporary_password", "user"]);
        assert.deepEqual(Object.keys(response.body.user).sort(), USER_FIELDS);
        assert.equal(response.body.user.email, email);
        assert.equal(response.body.user.role, "admin");
        assert.equal(response.body.user.must_change_password, true);
        assert.match(response.body.temporary_password, TEMPORARY_PASSWORD);

        const signedIn = await api.post("/auth/login", { body: { email, password: response.body.temporary_password } });
        assert.equal(signedIn.status, 200, signedIn.text);
        assert.equal(signedIn.body.user.must_change_password, true);
    });

    test("creating an admin with a password keeps it, and checks the email and password", async () => {
        const owner = await signInOwner(api);
        const email = uniqueEmail("kept");
        const create = (body) => api.post("/auth/admins", { cookie: owner.cookie, body });

        const response = await create({ email, password: "admin-password-123" });
        assert.equal(response.status, 201, response.text);
        assert.equal(response.body.temporary_password, null);
        assert.equal(response.body.user.must_change_password, false);

        await expectError(create({ email: "nope" }), 422, "Enter a valid email address.");
        await expectError(create({ email: email.toUpperCase() }), 409, "An admin with that email already exists.");
        await expectError(create({ email: uniqueEmail(), password: "short" }), 422, "Use at least 12 characters.");
    });

    test("resetting an admin's password signs them out and returns a temporary password unless one is given", async () => {
        const owner = await signInOwner(api);
        const admin = await createAdmin(owner);
        const adminCookie = await signIn(api, admin);

        const response = await api.post(`/auth/admins/${admin.user.id}/reset-password`, { cookie: owner.cookie });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), ["temporary_password", "user"]);
        assert.match(response.body.temporary_password, TEMPORARY_PASSWORD);
        assert.equal(response.body.user.must_change_password, true);
        assert.equal(await currentUser(adminCookie), null);

        const typed = await api.post(`/auth/admins/${admin.user.id}/reset-password`, {
            cookie: owner.cookie,
            body: { password: "typed-password-123" },
        });
        assert.equal(typed.body.temporary_password, null);
        assert.equal(typed.body.user.must_change_password, false);
        assert.ok(await signIn(api, { email: admin.email, password: "typed-password-123" }));
    });

    test("disabling an admin signs them out until they are enabled again", async () => {
        const owner = await signInOwner(api);
        const admin = await createAdmin(owner);
        const adminCookie = await signIn(api, admin);

        const disabled = await api.post(`/auth/admins/${admin.user.id}/disable`, { cookie: owner.cookie });
        assert.equal(disabled.status, 200, disabled.text);
        assert.deepEqual(Object.keys(disabled.body), ["user"]);
        assert.ok(!Number.isNaN(Date.parse(disabled.body.user.disabled_at)));
        assert.equal(await currentUser(adminCookie), null);

        const again = await api.post(`/auth/admins/${admin.user.id}/disable`, { cookie: owner.cookie });
        assert.equal(again.body.user.disabled_at, disabled.body.user.disabled_at);

        const enabled = await api.post(`/auth/admins/${admin.user.id}/enable`, { cookie: owner.cookie });
        assert.equal(enabled.status, 200, enabled.text);
        assert.equal(enabled.body.user.disabled_at, null);
        assert.ok(await signIn(api, admin));
    });

    test("a session made before an account is disabled no longer counts", async () => {
        const owner = await signInOwner(api);
        const admin = await createAdmin(owner);
        const adminCookie = await signIn(api, admin);
        await pool.query("UPDATE admin_users SET disabled_at = NOW() WHERE id = $1", [admin.user.id]);

        assert.equal(await currentUser(adminCookie), null);
        await expectError(api.post("/movies", { cookie: adminCookie, body: movieBody() }), 401, SIGN_IN_REQUIRED.error);
    });

    test("answers 404 for a missing account and 403 for the owner's own account", async () => {
        const owner = await signInOwner(api);
        const missing = randomUUID();

        await expectError(api.post(`/auth/admins/${missing}/reset-password`, { cookie: owner.cookie }), 404, "Admin not found.");
        await expectError(api.post(`/auth/admins/${missing}/disable`, { cookie: owner.cookie }), 404, "Admin not found.");
        await expectError(api.post(`/auth/admins/${missing}/enable`, { cookie: owner.cookie }), 404, "Admin not found.");

        await expectError(
            api.post(`/auth/admins/${owner.user.id}/reset-password`, { cookie: owner.cookie }),
            403,
            "Use the account menu to change your own password."
        );
        await expectError(api.post(`/auth/admins/${owner.user.id}/disable`, { cookie: owner.cookie }), 403, "The owner account can't be disabled.");
        await expectError(api.post(`/auth/admins/${owner.user.id}/enable`, { cookie: owner.cookie }), 403, "The owner account can't be disabled.");
    });
});

test("sessionCookieFrom reads nothing from a response that sets no cookie", async () => {
    assert.equal(sessionCookieFrom(await api.get("/health")), null);
});
