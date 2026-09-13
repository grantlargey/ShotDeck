/**
 * Admin session persistence, keyed by the SHA-256 of the cookie token.
 */
export async function createSession(db, { tokenHash, userId, expiresAt }) {
    await db.query(
        `
        INSERT INTO admin_sessions (token_hash, user_id, expires_at)
        VALUES ($1, $2, $3)
      `,
        [tokenHash, userId, expiresAt]
    );
}

/** The session and its user in one row, or null when the token is unknown or expired. */
export async function findLiveSessionWithUser(db, tokenHash) {
    const result = await db.query(
        `
        SELECT s.token_hash,
               s.last_seen_at,
               s.expires_at,
               u.*
        FROM admin_sessions s
        JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.expires_at > NOW()
      `,
        [tokenHash]
    );
    return result.rows[0] || null;
}

export async function touchSession(db, { tokenHash, expiresAt }) {
    await db.query(
        `
        UPDATE admin_sessions
        SET last_seen_at = NOW(),
            expires_at = $2
        WHERE token_hash = $1
      `,
        [tokenHash, expiresAt]
    );
}

export async function deleteSession(db, tokenHash) {
    await db.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [tokenHash]);
}

/** Signs a user out everywhere, optionally keeping the session they are using right now. */
export async function deleteSessionsForUser(db, { userId, keepTokenHash = null }) {
    await db.query(
        `
        DELETE FROM admin_sessions
        WHERE user_id = $1
          AND ($2::text IS NULL OR token_hash <> $2)
      `,
        [userId, keepTokenHash]
    );
}

export async function deleteExpiredSessions(db) {
    await db.query(`DELETE FROM admin_sessions WHERE expires_at <= NOW()`);
}
