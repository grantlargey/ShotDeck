import { displayScriptSceneText, safeScriptSceneTags } from "@/entities/script-scene";
import { screenplayToPlainText } from "@/shared/lib/screenplay";
import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time";
import {
  anchorPairKey,
  anchorsFromGeometry,
  anchorsToGeometry,
  hasAnyAnchor,
  NO_ANCHORS,
  placeAnchor,
  withoutSuggestions,
} from "./anchors.js";

/*
 * Draft state for the annotator panel.
 *
 * `textOrigin` records where the draft text came from:
 * - "capture": live text derived from the anchors (not stored in the draft)
 * - "edited":  the user changed the text by hand
 * - "ai":      the user accepted an AI proposal
 * - "saved":   text loaded from a saved scene
 *
 * `textAnchorKey` is the anchor pair the text belongs to, which lets the panel
 * notice when anchors move after the text was edited or saved.
 */

const HISTORY_LIMIT = 50;

function timeField(seconds) {
  return seconds === null || seconds === undefined ? "" : formatSecondsToHms(seconds, { fallback: "" });
}

export function createEmptyDraft() {
  return {
    sceneId: "",
    baseline: null,
    anchors: NO_ANCHORS,
    anchorHistory: [],
    suggestionsDismissed: false,
    startTime: "",
    endTime: "",
    tags: [],
    textOrigin: "capture",
    markdown: "",
    textAnchorKey: "",
    editorRevision: 0,
    proposal: null,
  };
}

function withAnchors(draft, anchors) {
  if (anchorPairKey(anchors) === anchorPairKey(draft.anchors) && hasAnyAnchor(anchors) === hasAnyAnchor(draft.anchors)) {
    const sameStart = draft.anchors.start?.line === anchors.start?.line && draft.anchors.start?.page === anchors.start?.page;
    const sameEnd = draft.anchors.end?.line === anchors.end?.line && draft.anchors.end?.page === anchors.end?.page;
    if (sameStart && sameEnd) return { ...draft, anchors };
  }
  return {
    ...draft,
    anchors,
    anchorHistory: [...draft.anchorHistory, draft.anchors].slice(-HISTORY_LIMIT),
  };
}

function draftFromScene(scene, editorRevision) {
  const anchors = anchorsFromGeometry(scene.anchor_geometry) || NO_ANCHORS;
  return {
    ...createEmptyDraft(),
    sceneId: scene.id,
    baseline: scene,
    anchors,
    startTime: timeField(scene.start_time_seconds),
    endTime: timeField(scene.end_time_seconds),
    tags: safeScriptSceneTags(scene.tags),
    textOrigin: "saved",
    markdown: displayScriptSceneText(scene),
    textAnchorKey: anchorPairKey(anchors),
    editorRevision,
  };
}

export function draftReducer(draft, action) {
  switch (action.type) {
    case "reset":
      return { ...createEmptyDraft(), editorRevision: draft.editorRevision + 1 };

    case "loadScene":
      return draftFromScene(action.scene, draft.editorRevision + 1);

    case "setAnchor":
      return withAnchors(draft, placeAnchor(action.currentAnchors, action.kind, action.anchor));

    case "removeAnchor":
      return withAnchors(draft, { ...withoutSuggestions(action.currentAnchors), [action.kind]: null });

    case "clearAnchors":
      return {
        ...(hasAnyAnchor(draft.anchors) ? withAnchors(draft, NO_ANCHORS) : draft),
        suggestionsDismissed: true,
      };

    case "undoAnchors": {
      if (draft.anchorHistory.length === 0) return draft;
      return {
        ...draft,
        anchors: draft.anchorHistory[draft.anchorHistory.length - 1],
        anchorHistory: draft.anchorHistory.slice(0, -1),
      };
    }

    case "setTime":
      return { ...draft, [action.field]: action.value };

    case "toggleTag":
      return {
        ...draft,
        tags: draft.tags.includes(action.tag)
          ? draft.tags.filter((tag) => tag !== action.tag)
          : [...draft.tags, action.tag],
      };

    case "clearTags":
      return { ...draft, tags: [] };

    case "editMarkdown":
      return {
        ...draft,
        markdown: action.markdown,
        textOrigin: "edited",
        textAnchorKey: action.anchorKey ?? draft.textAnchorKey,
      };

    case "applyCapture":
      return {
        ...withAnchors(draft, withoutSuggestions(action.anchors)),
        textOrigin: "capture",
        markdown: action.capture.markdown,
        textAnchorKey: action.capture.key,
        editorRevision: draft.editorRevision + 1,
      };

    case "proposalStart":
      return { ...draft, proposal: { requestId: action.requestId, status: "loading", markdown: "", error: "" } };

    case "proposalReady":
      if (draft.proposal?.requestId !== action.requestId) return draft;
      return { ...draft, proposal: { ...draft.proposal, status: "ready", markdown: action.markdown } };

    case "proposalError":
      if (draft.proposal?.requestId !== action.requestId) return draft;
      return { ...draft, proposal: { ...draft.proposal, status: "error", error: action.error } };

    case "proposalDiscard":
      return { ...draft, proposal: null };

    case "proposalAccept":
      if (draft.proposal?.status !== "ready") return draft;
      return {
        ...draft,
        markdown: draft.proposal.markdown,
        textOrigin: "ai",
        textAnchorKey: action.anchorKey ?? draft.textAnchorKey,
        editorRevision: draft.editorRevision + 1,
        proposal: null,
      };

    default:
      return draft;
  }
}

export function isDraftDirty(draft, markdown) {
  if (!draft.sceneId) {
    return (
      hasAnyAnchor(draft.anchors) ||
      Boolean(markdown.trim() || draft.startTime || draft.endTime || draft.tags.length)
    );
  }

  const scene = draft.baseline;
  return (
    draft.startTime !== timeField(scene.start_time_seconds) ||
    draft.endTime !== timeField(scene.end_time_seconds) ||
    draft.tags.join("|") !== safeScriptSceneTags(scene.tags).join("|") ||
    markdown !== displayScriptSceneText(scene) ||
    anchorPairKey(draft.anchors) !== anchorPairKey(anchorsFromGeometry(scene.anchor_geometry))
  );
}

/**
 * Explains what's wrong with a scene's film timing, or returns "" when it's
 * fine. While typing, pass `{ checkFormat: false }` so half-typed times aren't
 * flagged; saving uses `{ requireBoth: true }`. A runtime of 0 means unknown.
 */
export function getTimingError(startTime, endTime, runtimeSeconds, { checkFormat = true, requireBoth = false } = {}) {
  const startText = String(startTime ?? "").trim();
  const endText = String(endTime ?? "").trim();
  const start = parseTimeInputToSeconds(startText);
  const end = parseTimeInputToSeconds(endText);

  if (checkFormat && ((startText && start === null) || (endText && end === null))) {
    return "Use HH:MM:SS (or MM:SS) for the start and end times.";
  }
  if (requireBoth && (start === null || end === null)) {
    return "Enter a start and an end time for this scene.";
  }
  if (start !== null && end !== null && end < start) {
    return "The end time must be at or after the start time.";
  }
  const runtime = Number(runtimeSeconds);
  if (Number.isFinite(runtime) && runtime > 0 && ((start ?? 0) > runtime || (end ?? 0) > runtime)) {
    return `Times can't be later than the film's runtime (${formatSecondsToHms(runtime)}).`;
  }
  return "";
}

/**
 * Validates the draft and shapes the API payload. Location fields come from
 * the live capture when the user has placed anchors; otherwise a saved scene
 * keeps its stored location.
 */
export function buildScenePayload({ draft, capture, markdown, runtimeSeconds = 0 }) {
  const timingError = getTimingError(draft.startTime, draft.endTime, runtimeSeconds, { requireBoth: true });
  if (timingError) {
    return { error: timingError };
  }
  const start = parseTimeInputToSeconds(draft.startTime);
  const end = parseTimeInputToSeconds(draft.endTime);
  if (!markdown.trim()) {
    return { error: "Place start and end anchors in the script to capture the scene text." };
  }

  const useCapture = Boolean(capture) && hasAnyAnchor(draft.anchors);
  const baseline = draft.baseline;
  let location = null;

  if (useCapture) {
    location = {
      page_start: capture.pageStart,
      page_end: capture.pageEnd,
      start_offset: capture.startOffset,
      end_offset: capture.endOffset,
      context_prefix: capture.contextPrefix || null,
      context_suffix: capture.contextSuffix || null,
      anchor_geometry: anchorsToGeometry(draft.anchors),
    };
  } else if (baseline) {
    location = {
      page_start: baseline.page_start ?? null,
      page_end: baseline.page_end ?? null,
      start_offset: baseline.start_offset ?? null,
      end_offset: baseline.end_offset ?? null,
      context_prefix: baseline.context_prefix ?? null,
      context_suffix: baseline.context_suffix ?? null,
      anchor_geometry: Array.isArray(baseline.anchor_geometry) ? baseline.anchor_geometry : [],
    };
  }

  if (!location) {
    return { error: "Place start and end anchors in the script to capture the scene text." };
  }

  return {
    payload: {
      start_time_seconds: start,
      end_time_seconds: end,
      selected_text: markdown,
      raw_selected_text: useCapture
        ? capture.plainText
        : baseline?.raw_selected_text || screenplayToPlainText(markdown),
      formatted_selected_text: markdown,
      ...location,
      tags: draft.tags,
    },
  };
}
