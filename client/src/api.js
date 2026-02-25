// client/src/api.js
const API_BASE =
    import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:4000";

async function req(path, opts) {
    const res = await fetch(`${API_BASE}${path}`, opts);

    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { raw: text };
    }

    if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
    }
    return data;
}

export const api = {
    // Movies
    listMovies: () => req("/movies"),
    getMovie: (id) => req(`/movies/${id}`),

    createMovie: (payload) =>
        req("/movies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }),

    updateMovie: (id, payload) =>
        req(`/movies/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }),

    // Annotations
    listAnnotations: (movieId) => req(`/movies/${movieId}/annotations`),

    createAnnotation: (movieId, payload) =>
        req(`/movies/${movieId}/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }),

    deleteAnnotation: (movieId, annotationId) =>
        req(`/movies/${movieId}/annotations/${annotationId}`, {
            method: "DELETE",
        }),
};