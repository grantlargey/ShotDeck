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
    let res;
    try {
        res = await fetch(`${API_BASE}${path}`, opts);
    } catch {
        throw new Error(
            `Network error calling ${API_BASE}${path}. Check VITE_API_BASE, HTTPS, and CORS.`
        );
    }

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

function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof tags === "string") {
        return tags
            .split(/[,\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}

export const api = {
    formatAnnotationText: (rawText) =>
        req("/api/annotations/format", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rawText }),
        }),

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

    deleteMovie: (id) =>
        req(`/movies/${encodeURIComponent(id)}`, {
            method: "DELETE",
        }),

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

    // Scripts
    listScripts: (movieId) => req(`/movies/${encodeURIComponent(movieId)}/scripts`),

    getScript: (movieId, scriptId) =>
        req(`/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}`),

    findSceneByTime: (movieId, timeSeconds, options = {}) => {
        const params = new URLSearchParams();
        params.set("time", String(timeSeconds));
        if (options.scriptId) params.set("script_id", String(options.scriptId));
        return req(`/movies/${encodeURIComponent(movieId)}/scene-by-time?${params.toString()}`);
    },

    saveScript: (movieId, payload) =>
        req(`/movies/${encodeURIComponent(movieId)}/scripts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }),

    // Script scenes (persistent anchors + metadata)
    listScriptScenes: (movieId, scriptId, options = {}) => {
        const params = new URLSearchParams();
        if (options.tags) {
            const tags = normalizeTags(options.tags);
            if (tags.length) params.set("tags", tags.join(","));
        }
        if (options.match === "any") params.set("match", "any");
        const qs = params.toString();
        return req(
            `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations${qs ? `?${qs}` : ""}`
        );
    },

    createScriptScene: (movieId, scriptId, payload) => {
        const body = { ...payload };
        if ("tags" in body) body.tags = normalizeTags(body.tags);

        return req(`/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    },

    updateScriptScene: (movieId, scriptId, sceneId, payload) => {
        const body = { ...payload };
        if ("tags" in body) body.tags = normalizeTags(body.tags);

        return req(
            `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }
        );
    },

    deleteScriptScene: (movieId, scriptId, sceneId) =>
        req(
            `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations/${encodeURIComponent(sceneId)}`,
            { method: "DELETE" }
        ),

    searchScriptScenes: (options = {}) => {
        const params = new URLSearchParams();
        if (options.tags) {
            const tags = normalizeTags(options.tags);
            if (tags.length) params.set("tags", tags.join(","));
        }
        if (options.match === "any") params.set("match", "any");
        if (options.movie_id) params.set("movie_id", String(options.movie_id));
        if (options.script_id) params.set("script_id", String(options.script_id));
        if (typeof options.q === "string" && options.q.trim()) params.set("q", options.q.trim());
        const qs = params.toString();
        return req(`/script-scenes${qs ? `?${qs}` : ""}`);
    },

    // Backwards-compatible wrappers
    listScriptAnnotations: (movieId, scriptId, options = {}) => {
        const params = new URLSearchParams();
        if (options.tags) {
            const tags = normalizeTags(options.tags);
            if (tags.length) params.set("tags", tags.join(","));
        }
        if (options.match === "any") params.set("match", "any");
        const qs = params.toString();
        return req(
            `/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations${qs ? `?${qs}` : ""}`
        );
    },

    createScriptAnnotation: (movieId, scriptId, payload) => {
        const body = { ...payload };
        if ("tags" in body) body.tags = normalizeTags(body.tags);

        return req(`/movies/${encodeURIComponent(movieId)}/scripts/${encodeURIComponent(scriptId)}/scene-annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    },

    searchScriptAnnotations: (options = {}) => {
        const params = new URLSearchParams();
        if (options.tags) {
            const tags = normalizeTags(options.tags);
            if (tags.length) params.set("tags", tags.join(","));
        }
        if (options.match === "any") params.set("match", "any");
        if (options.movie_id) params.set("movie_id", String(options.movie_id));
        if (options.script_id) params.set("script_id", String(options.script_id));
        if (typeof options.q === "string" && options.q.trim()) params.set("q", options.q.trim());
        const qs = params.toString();
        return req(`/script-scenes${qs ? `?${qs}` : ""}`);
    },

    // Upload viewing (handy fallback if API only gives keys)
    getViewUrlForKey: (key) =>
        req(`/uploads/view-url?key=${encodeURIComponent(key)}`),
};
