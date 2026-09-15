import { Router } from "express";
import { pool } from "../db.js";
import { loadAdminUser, requireAdmin, requireOwner } from "../middleware/require-admin.js";
import * as authService from "../services/auth.service.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../utils/cookies.js";

/**
 * Sign-in and admin account routes. There is deliberately no sign-up route:
 * accounts are created by the owner (below) or by the admin CLI. Account rules
 * live in services/auth.service.js.
 */
const router = Router();

/**
 * The API shape of an admin account. It lists its fields explicitly, so it never
 * includes the password hash or session details, whatever row it is given.
 */
function toAdminUserResponse(row) {
    if (!row) return null;
    return {
        id: row.id,
        email: row.email,
        role: row.role,
        must_change_password: Boolean(row.must_change_password),
        created_at: row.created_at,
        last_login_at: row.last_login_at ?? null,
        disabled_at: row.disabled_at ?? null,
    };
}

router.post("/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    const { user, token } = await authService.login(pool, { email, password, ip: req.ip });
    setSessionCookie(req, res, token);
    res.json({ user: toAdminUserResponse(user) });
});

router.post("/auth/logout", async (req, res) => {
    await authService.logout(pool, readSessionToken(req));
    clearSessionCookie(req, res);
    res.status(204).send();
});

// Who the cookie belongs to. Visitors get `{ user: null }`, never an error.
router.get("/auth/me", async (req, res) => {
    res.json({ user: toAdminUserResponse(await loadAdminUser(req)) });
});

router.post("/auth/password", requireAdmin, async (req, res) => {
    const { current_password, new_password } = req.body || {};
    const user = await authService.changeOwnPassword(pool, {
        user: req.adminUser,
        currentPassword: current_password,
        newPassword: new_password,
    });
    res.json({ user: toAdminUserResponse(user) });
});

router.get("/auth/admins", requireOwner, async (req, res) => {
    const rows = await authService.listAdmins(pool);
    res.json(rows.map((row) => toAdminUserResponse(row)));
});

router.post("/auth/admins", requireOwner, async (req, res) => {
    const { email, password } = req.body || {};
    const { user, temporaryPassword } = await authService.createAdmin(pool, { email, password });
    res.status(201).json({ user: toAdminUserResponse(user), temporary_password: temporaryPassword });
});

router.post("/auth/admins/:id/reset-password", requireOwner, async (req, res) => {
    const { password } = req.body || {};
    const { user, temporaryPassword } = await authService.resetAdminPassword(pool, {
        actor: req.adminUser,
        id: req.params.id,
        password,
    });
    res.json({ user: toAdminUserResponse(user), temporary_password: temporaryPassword });
});

router.post("/auth/admins/:id/disable", requireOwner, async (req, res) => {
    const user = await authService.setAdminDisabled(pool, { actor: req.adminUser, id: req.params.id, disabled: true });
    res.json({ user: toAdminUserResponse(user) });
});

router.post("/auth/admins/:id/enable", requireOwner, async (req, res) => {
    const user = await authService.setAdminDisabled(pool, { actor: req.adminUser, id: req.params.id, disabled: false });
    res.json({ user: toAdminUserResponse(user) });
});

export default router;
