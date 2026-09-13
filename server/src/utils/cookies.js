/**
 * The admin session cookie. It is HttpOnly (page scripts can't read it),
 * SameSite=Lax (not sent on cross-site POSTs), and Secure whenever the request
 * arrived over HTTPS, which the load balancer reports through X-Forwarded-Proto.
 */
export const SESSION_COOKIE = "sd_admin";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function parseCookies(header) {
    const cookies = {};
    if (typeof header !== "string" || !header) return cookies;

    for (const part of header.split(";")) {
        const index = part.indexOf("=");
        if (index < 0) continue;
        const name = part.slice(0, index).trim();
        if (!name) continue;
        let value = part.slice(index + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        try {
            cookies[name] = decodeURIComponent(value);
        } catch {
            cookies[name] = value;
        }
    }
    return cookies;
}

export function readSessionToken(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return typeof token === "string" && token ? token : null;
}

function baseOptions(req) {
    return { httpOnly: true, sameSite: "lax", secure: Boolean(req.secure), path: "/" };
}

export function setSessionCookie(req, res, token) {
    res.cookie(SESSION_COOKIE, token, { ...baseOptions(req), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(req, res) {
    res.clearCookie(SESSION_COOKIE, baseOptions(req));
}
