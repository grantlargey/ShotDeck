/**
 * Centralizes browser access rules for the API.
 *
 * Keeping CORS setup outside of app construction makes the allowed-origin
 * policy easy to audit without digging through route registration.
 */
export function createCorsOptions() {
    const allowedOrigins = new Set([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        ...(process.env.ALLOWED_ORIGINS || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
    ]);

    return {
        origin(origin, callback) {
            if (!origin || allowedOrigins.has(origin)) {
                return callback(null, true);
            }
            return callback(null, false);
        },
    };
}
