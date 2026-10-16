import { parseFilmMoment } from "@/entities/script-scene/model/filmTiming.js";
import { ValidationError } from "@/shared/lib/errors.js";

/**
 * A typed still timestamp in seconds, for the two places an admin types one:
 * the add dialog and the viewer's edit form. Throws the film timing message so
 * whichever form asked can show it. `runtimeSeconds` plus one minute caps the
 * moment; 0 means the runtime is unknown.
 */
export function readStillSeconds(text, runtimeSeconds) {
  const { seconds, error } = parseFilmMoment(text, runtimeSeconds);
  if (error) throw new ValidationError(error);
  return seconds;
}
