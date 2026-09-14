import { formatMinutesToHms } from "@/shared/lib/time.js";

export function createMovieEditForm(movie) {
  return {
    title: movie?.title ?? "",
    director: movie?.director ?? "",
    writer: movie?.writer ?? "",
    cinematographer: movie?.cinematographer ?? "",
    year: movie?.year ?? "",
    runtime_hms: formatMinutesToHms(movie?.runtime_minutes, { fallback: "00:00:00" }),
  };
}

export function buildMovieSavePayload(form, runtimeMinutes) {
  return {
    title: form.title.trim(),
    director: form.director.trim(),
    writer: form.writer.trim() || null,
    cinematographer: form.cinematographer.trim() || null,
    year: Number(form.year) || null,
    runtime_minutes: runtimeMinutes,
  };
}
