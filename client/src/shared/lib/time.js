function toInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function formatSecondsToHms(totalSeconds, options = {}) {
  const fallback = options.fallback ?? "--:--:--";
  const secondsInt = toInteger(totalSeconds);
  if (secondsInt === null || secondsInt < 0) return fallback;

  const hours = Math.floor(secondsInt / 3600);
  const minutes = Math.floor((secondsInt % 3600) / 60);
  const seconds = secondsInt % 60;

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

export function formatMinutesToHms(totalMinutes, options = {}) {
  const fallback = options.fallback ?? "--:--:--";
  const minutesInt = toInteger(totalMinutes);
  if (minutesInt === null || minutesInt < 0) return fallback;
  return formatSecondsToHms(minutesInt * 60, { fallback });
}

export function parseTimeInputToSeconds(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null;
  }

  const parts = text.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;

  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || seconds < 0 || seconds > 59) return null;
    return minutes * 60 + seconds;
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (hours < 0 || minutes < 0 || seconds < 0 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Reformats typed time as HH:MM:SS, returning input it can't parse as typed. */
export function normalizeTypedTime(value) {
  const seconds = parseTimeInputToSeconds(value);
  return seconds === null ? value : formatSecondsToHms(seconds);
}

/*
 * Moments: a film still's time, kept to a tenth of a second so two shots caught
 * in the same second keep their order. Runtimes and a captured scene's start
 * and end stay whole seconds and use the helpers above.
 */

const TENTHS_PER_SECOND = 10;
const TYPED_TENTH = /^(.+)\.(\d)$/;

/** Typed time as seconds to a tenth, "HH:MM:SS.s" or any form above, or null. */
export function parseMomentInputToSeconds(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * TENTHS_PER_SECOND) / TENTHS_PER_SECOND;
  }

  const typed = TYPED_TENTH.exec(String(value ?? "").trim());
  const seconds = parseTimeInputToSeconds(typed ? typed[1] : value);
  if (seconds === null) return null;
  return typed ? (seconds * TENTHS_PER_SECOND + Number(typed[2])) / TENTHS_PER_SECOND : seconds;
}

/** A moment as HH:MM:SS, carrying its tenth when it has one. */
export function formatMomentToHms(totalSeconds, options = {}) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return options.fallback ?? "--:--:--";

  const tenths = Math.round(seconds * TENTHS_PER_SECOND);
  const whole = formatSecondsToHms(Math.floor(tenths / TENTHS_PER_SECOND), options);
  return tenths % TENTHS_PER_SECOND === 0 ? whole : `${whole}.${tenths % TENTHS_PER_SECOND}`;
}

/** Reformats a typed moment as HH:MM:SS.s, returning input it can't parse as typed. */
export function normalizeTypedMoment(value) {
  const seconds = parseMomentInputToSeconds(value);
  return seconds === null ? value : formatMomentToHms(seconds);
}

/** Typed time as whole minutes, rounded to the nearest minute, or null when it can't be parsed. */
export function parseTimeInputToMinutes(value) {
  const seconds = parseTimeInputToSeconds(value);
  return seconds === null ? null : Math.round(seconds / 60);
}
