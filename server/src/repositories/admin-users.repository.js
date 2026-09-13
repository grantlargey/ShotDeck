/**
 * Admin account persistence. Rows include password_hash; the serializer is the
 * only place that shapes them for API responses.
 */
export async function createAdminUser(db, { id, email, passwordHash, role, mustChangePassword }) {
    const result = await db.query(
        `
        INSERT INTO admin_users (id, email, password_hash, role, must_change_password)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
        [id, email, passwordHash, role, mustChangePassword]
    );
    return result.rows[0];
}

export async function findAdminUserByEmail(db, email) {
    const result = await db.query(`SELECT * FROM admin_users WHERE LOWER(email) = LOWER($1)`, [email]);
    return result.rows[0] || null;
}

export async function findAdminUserById(db, id) {
    const result = await db.query(`SELECT * FROM admin_users WHERE id = $1`, [id]);
    return result.rows[0] || null;
}

/** Owner first, then admins by creation date. */
export async function listAdminUsers(db) {
    const result = await db.query(
        `
        SELECT *
        FROM admin_users
        ORDER BY (role = 'owner') DESC, created_at ASC
      `
    );
    return result.rows;
}

export async function updateAdminPassword(db, { id, passwordHash, mustChangePassword }) {
    const result = await db.query(
        `
        UPDATE admin_users
        SET password_hash = $2,
            must_change_password = $3
        WHERE id = $1
        RETURNING *
      `,
        [id, passwordHash, mustChangePassword]
    );
    return result.rows[0] || null;
}

export async function setAdminDisabled(db, { id, disabled }) {
    const result = await db.query(
        `
        UPDATE admin_users
        SET disabled_at = CASE WHEN $2 THEN COALESCE(disabled_at, NOW()) ELSE NULL END
        WHERE id = $1
        RETURNING *
      `,
        [id, disabled]
    );
    return result.rows[0] || null;
}

export async function touchAdminLastLogin(db, id) {
    await db.query(`UPDATE admin_users SET last_login_at = NOW() WHERE id = $1`, [id]);
}
