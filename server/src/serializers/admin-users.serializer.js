/**
 * The API shape of an admin account. Never includes the password hash or
 * session details, whatever row it is given.
 */
export function serializeAdminUser(row) {
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
