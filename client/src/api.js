// client/src/api.js
const API_BASE =
    import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:4000";

/**
 * Low-level request helper:
 * - Always reads text first (so we can surface non-JSON errors)
 * - Parses JSON when possible
 * - Throws a useful Error message when !res.ok
 */
async function req(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, opts);

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    let data = null;
    if (text) {
        // Prefer JSON when server says it's JSON, otherwise try anyway
        if (contentType.includes("application/json")) {
            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }
        } else {
            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }
        }
    }

    if (!res.ok) {
        // Try common error shapes
        const msg =
            (data && (data.error || data.message)) ||
            (data && data.raw) ||
            `${res.status} ${res.statusText}`;
        throw new Error(msg);
    }

    return data;
}

/**
 * Convenience: normalize "links" coming from UI.
 * - Accepts string (textarea) OR array.
 * - Produces array of non-empty strings.
 */
function normalizeLinks(links) {
    if (Array.isArray(links)) return links.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof links === "string") {
        return links
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}

export const api = {
    // Movies
    listMovies: () => req("/movies"),

    getMovie: (id) => req(`/movies/${encodeURIComponent(id)}`),

    createMovie: (payload) => {
        const body = { ...payload };
        if ("links" in body) body.links = normalizeLinks(body.links);

        return req("/movies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    },

    updateMovie: (id, payload) => {
        const body = { ...payload };
        if ("links" in body) body.links = normalizeLinks(body.links);

        return req(`/movies/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    },

    // Annotations
    listAnnotations: (movieId) =>
        req(`/movies/${encodeURIComponent(movieId)}/annotations`),

    createAnnotation: (movieId, payload) =>
        req(`/movies/${encodeURIComponent(movieId)}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }),

    updateAnnotation: (movieId, annotationId, payload) =>
        req(
            `/movies/${encodeURIComponent(movieId)}/annotations/${encodeURIComponent(
                annotationId
            )}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }
        ),

    deleteAnnotation: (movieId, annotationId) =>
        req(
            `/movies/${encodeURIComponent(movieId)}/annotations/${encodeURIComponent(
                annotationId
            )}`,
            { method: "DELETE" }
        ),

    // Upload viewing (handy fallback if API only gives keys)
    getViewUrlForKey: (key) =>
        req(`/uploads/view-url?key=${encodeURIComponent(key)}`),
};