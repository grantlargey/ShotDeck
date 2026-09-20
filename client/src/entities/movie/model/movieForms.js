import { ValidationError } from "@/shared/lib/errors.js";
import { formatMinutesToHms, parseTimeInputToMinutes } from "@/shared/lib/time.js";

const RUNTIME_ERROR = "Runtime must use HH:MM:SS and be at least 00:01:00.";

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

export function buildMovieSavePayload(form) {
  const runtimeMinutes = parseTimeInputToMinutes(form.runtime_hms);
  if (runtimeMinutes === null || runtimeMinutes < 1) throw new ValidationError(RUNTIME_ERROR);

  return {
    title: form.title.trim(),
    director: form.director.trim(),
    writer: form.writer.trim() || null,
    cinematographer: form.cinematographer.trim() || null,
    year: Number(form.year) || null,
    runtime_minutes: runtimeMinutes,
  };
}
