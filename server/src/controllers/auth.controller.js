import { pool } from "../db.js";
import { loadAdminUser } from "../middleware/require-admin.js";
import { serializeAdminUser } from "../serializers/admin-users.serializer.js";
import * as authService from "../services/auth.service.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../utils/cookies.js";

export async function login(req, res) {
    const { email, password } = req.body || {};
    const { user, token } = await authService.login(pool, { email, password, ip: req.ip });
    setSessionCookie(req, res, token);
    return res.json({ user: serializeAdminUser(user) });
}

export async function logout(req, res) {
    await authService.logout(pool, readSessionToken(req));
    clearSessionCookie(req, res);
    return res.status(204).send();
}

/** Who the cookie belongs to. Visitors get `{ user: null }`, never an error. */
export async function me(req, res) {
    const user = await loadAdminUser(req);
    return res.json({ user: serializeAdminUser(user) });
}

export async function changePassword(req, res) {
    const { current_password, new_password } = req.body || {};
    const user = await authService.changeOwnPassword(pool, {
        user: req.adminUser,
        currentPassword: current_password,
        newPassword: new_password,
    });
    return res.json({ user: serializeAdminUser(user) });
}

export async function listAdmins(req, res) {
    const rows = await authService.listAdmins(pool);
    return res.json(rows.map(serializeAdminUser));
}

export async function createAdmin(req, res) {
    const { email, password } = req.body || {};
    const { user, temporaryPassword } = await authService.createAdmin(pool, { email, password });
    return res.status(201).json({ user: serializeAdminUser(user), temporary_password: temporaryPassword });
}

export async function resetAdminPassword(req, res) {
    const { password } = req.body || {};
    const { user, temporaryPassword } = await authService.resetAdminPassword(pool, {
        actor: req.adminUser,
        id: req.params.id,
        password,
    });
    return res.json({ user: serializeAdminUser(user), temporary_password: temporaryPassword });
}

export async function disableAdmin(req, res) {
    const user = await authService.setAdminDisabled(pool, { actor: req.adminUser, id: req.params.id, disabled: true });
    return res.json({ user: serializeAdminUser(user) });
}

export async function enableAdmin(req, res) {
    const user = await authService.setAdminDisabled(pool, { actor: req.adminUser, id: req.params.id, disabled: false });
    return res.json({ user: serializeAdminUser(user) });
}
