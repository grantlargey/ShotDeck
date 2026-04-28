import { safeScriptSceneTags } from "@/entities/script-scene";
import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time";

export const EMPTY_SCENE_FORM = {
  start_time_seconds: "",
  end_time_seconds: "",
  raw_selected_text: "",
  formatted_selected_text: "",
  text_source: "raw",
  page_start: "",
  page_end: "",
  context_prefix: "",
  context_suffix: "",
  start_offset: "",
  end_offset: "",
  anchor_geometry: [],
  tags: [],
};

/**
 * Converts a saved script-scene row into the controlled form state expected by
 * the editor. Keeping this mapping here makes the page component focus on UI
 * flow instead of backend-to-form translation details.
 */
export function createSceneFormFromScene(scene) {
  const fallbackFormatted =
    scene?.formatted_selected_text || scene?.raw_selected_text || scene?.selected_text || "";

  return {
    start_time_seconds:
      scene?.start_time_seconds === null || scene?.start_time_seconds === undefined
        ? ""
        : formatSecondsToHms(scene.start_time_seconds, { fallback: "00:00:00" }),
    end_time_seconds:
      scene?.end_time_seconds === null || scene?.end_time_seconds === undefined
        ? ""
        : formatSecondsToHms(scene.end_time_seconds, { fallback: "00:00:00" }),
    raw_selected_text: scene?.raw_selected_text || scene?.selected_text || "",
    formatted_selected_text: fallbackFormatted,
    text_source:
      typeof scene?.formatted_selected_text === "string" && scene.formatted_selected_text.trim()
        ? "formatted"
        : "raw",
    page_start:
      scene?.page_start === null || scene?.page_start === undefined ? "" : String(scene.page_start),
    page_end:
      scene?.page_end === null || scene?.page_end === undefined ? "" : String(scene.page_end),
    context_prefix: scene?.context_prefix || "",
    context_suffix: scene?.context_suffix || "",
    start_offset:
      scene?.start_offset === null || scene?.start_offset === undefined
        ? ""
        : String(scene.start_offset),
    end_offset:
      scene?.end_offset === null || scene?.end_offset === undefined ? "" : String(scene.end_offset),
    anchor_geometry: Array.isArray(scene?.anchor_geometry) ? scene.anchor_geometry : [],
    tags: safeScriptSceneTags(scene?.tags),
  };
}

/**
 * Short preview shown below the readonly selected-text field.
 */
export function getSelectedCountText(form) {
  const len = form.raw_selected_text.trim().length;
  if (!len) return "No text selected yet.";
  if (len <= 140) return form.raw_selected_text.trim();
  return `${form.raw_selected_text.trim().slice(0, 140)}...`;
}

/**
 * The app stores both raw and formatted text. This decides which version should
 * be visible based on the user's radio-button choice.
 */
export function getSelectedTextPreview(form) {
  return form.text_source === "formatted" && form.formatted_selected_text
    ? form.formatted_selected_text
    : form.raw_selected_text;
}

/**
 * Parses, validates, and shapes the scene editor form into the backend payload.
 * It returns user-facing validation messages instead of throwing so submit
 * handlers can remain a simple happy-path flow.
 */
export function buildScriptScenePayload(form) {
  const start = parseTimeInputToSeconds(form.start_time_seconds);
  const end = parseTimeInputToSeconds(form.end_time_seconds);
  const pageStart = form.page_start === "" ? null : Number(form.page_start);
  const pageEnd = form.page_end === "" ? null : Number(form.page_end);
  const startOffset = form.start_offset === "" ? null : Number(form.start_offset);
  const endOffset = form.end_offset === "" ? null : Number(form.end_offset);

  if (start === null || end === null || start < 0 || end < start) {
    return {
      error: "Start/end time must use HH:MM:SS (or MM:SS) where end >= start.",
    };
  }

  if (
    (pageStart !== null && (!Number.isInteger(pageStart) || pageStart < 1)) ||
    (pageEnd !== null && (!Number.isInteger(pageEnd) || pageEnd < 1)) ||
    (pageStart !== null && pageEnd !== null && pageEnd < pageStart)
  ) {
    return {
      error: "Page range must be positive integers and page_end >= page_start.",
    };
  }

  if (
    (startOffset !== null && (!Number.isInteger(startOffset) || startOffset < 0)) ||
    (endOffset !== null && (!Number.isInteger(endOffset) || endOffset < 0)) ||
    (startOffset !== null && endOffset !== null && endOffset < startOffset)
  ) {
    return {
      error: "Offsets must be non-negative integers and end_offset >= start_offset.",
    };
  }

  if (!form.raw_selected_text.trim()) {
    return { error: "Select text in the PDF first." };
  }

  const selectedTextToSave =
    form.text_source === "formatted" && form.formatted_selected_text
      ? form.formatted_selected_text
      : form.raw_selected_text;

  return {
    payload: {
      start_time_seconds: start,
      end_time_seconds: end,
      selected_text: selectedTextToSave,
      raw_selected_text: form.raw_selected_text,
      formatted_selected_text: form.formatted_selected_text || null,
      page_start: pageStart,
      page_end: pageEnd,
      context_prefix: form.context_prefix || null,
      context_suffix: form.context_suffix || null,
      start_offset: startOffset,
      end_offset: endOffset,
      anchor_geometry: Array.isArray(form.anchor_geometry) ? form.anchor_geometry : [],
      tags: form.tags,
    },
  };
}
