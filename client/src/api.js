const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  listMovies: () => request("/movies"),
  getMovie: (id) => request(`/movies/${id}`),
  createMovie: (body) => request("/movies", { method: "POST", body: JSON.stringify(body) }),
  updateMovie: (id, body) => request(`/movies/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  listAnnotations: (movieId) => request(`/movies/${movieId}/annotations`),
  createAnnotation: (movieId, body) =>
    request(`/movies/${movieId}/annotations`, { method: "POST", body: JSON.stringify(body) }),
  deleteAnnotation: (movieId, annotationId) =>
    request(`/movies/${movieId}/annotations/${annotationId}`, { method: "DELETE" }),
};