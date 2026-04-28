import { api } from "@/shared/api";

export const movieActions = {
  create: (payload) => api.createMovie(payload),
  update: (id, payload) => api.updateMovie(id, payload),
  delete: (id) => api.deleteMovie(id),
};
