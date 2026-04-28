import { formatMinutesToHms } from "@/shared/lib/time";

export function createMovieEditForm(movie) {
  return {
    title: movie?.title ?? "",
    director: movie?.director ?? "",
    year: movie?.year ?? "",
    runtime_hms: formatMinutesToHms(movie?.runtime_minutes, { fallback: "00:00:00" }),
  };
}

export function buildMovieSavePayload(form, runtimeMinutes) {
  return {
    title: form.title.trim(),
    director: form.director.trim(),
    year: Number(form.year) || null,
    runtime_minutes: runtimeMinutes,
  };
}
