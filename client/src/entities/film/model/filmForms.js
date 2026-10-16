import { ValidationError } from "@/shared/lib/errors.js";
import { formatMinutesToHms, parseTimeInputToMinutes } from "@/shared/lib/time.js";

const RUNTIME_ERROR = "Runtime must use HH:MM:SS and be at least 00:01:00.";

export function createFilmEditForm(film) {
  return {
    title: film?.title ?? "",
    director: film?.director ?? "",
    writer: film?.writer ?? "",
    cinematographer: film?.cinematographer ?? "",
    year: film?.year ?? "",
    runtime_hms: formatMinutesToHms(film?.runtime_minutes, { fallback: "00:00:00" }),
  };
}

export function buildFilmSavePayload(form) {
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
