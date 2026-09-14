import { useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { displayScriptSceneText, safeScriptSceneTags } from "@/entities/script-scene";
import { screenplayToPlainText } from "@/shared/lib/screenplay";
import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time";
import {
  anchorPairKey,
  anchorsFromGeometry,
  anchorsToGeometry,
  createLineAnchor,
  hasAnyAnchor,
  NO_ANCHORS,
  placeAnchor,
  suggestAnchorsFromSavedText,
  withoutSuggestions,
} from "./anchors.js";
import { captureAnchoredRange, captureUnavailableReason } from "./captureRange.js";

/*
 * The scene draft: the captured scene an admin is creating or editing in the
 * script viewer, before it is saved.
 *
 * Text origin records where the draft's scene text came from:
 * - "capture": captured text, read live from the anchors in effect (not stored)
 * - "edited":  the admin changed the text by hand
 * - "ai":      the admin accepted an AI proposal
 * - "saved":   text loaded from a saved scene
 *
 * Text of any other origin is stored with the anchor pair key it belongs to
 * (`textAnchorKey`). When a capture exists under a different key the text is
 * stale; saved text with no key belongs to a legacy scene.
 *
 * An AI proposal keeps the selection its request was made from: the capture's
 * anchor key, else the draft text's own key. Accepting it keys the AI text to
 * that selection, so the text is stale if the anchors have moved since.
 *
 * Suggested anchors are derived, never stored. They are in effect for a saved
 * scene with no explicit anchors until the admin clears them, and stay out of
 * undo history, the dirty check and the saved script location until an anchor
 * change or a re-capture makes them explicit.
 */

const HISTORY_LIMIT = 50;

function timeField(seconds) {
  return seconds === null || seconds === undefined ? "" : formatSecondsToHms(seconds, { fallback: "" });
}

function createEmptyDraft(generation = 0) {
  return {
    // Loading or starting a draft invalidates earlier persistence responses,
    // even when the admin leaves a scene and later reopens that same scene.
    generation,
    savedScene: null,
    anchors: NO_ANCHORS,
    anchorHistory: [],
    suggestionsDismissed: false,
    startTime: "",
    endTime: "",
    tags: [],
    textOrigin: "capture",
    // Ignored while the origin is "capture".
    text: "",
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

function draftFromScene(scene, editorRevision, generation) {
  const anchors = anchorsFromGeometry(scene.anchor_geometry) || NO_ANCHORS;
  return {
    ...createEmptyDraft(generation),
    savedScene: scene,
    anchors,
    startTime: timeField(scene.start_time_seconds),
    endTime: timeField(scene.end_time_seconds),
    tags: safeScriptSceneTags(scene.tags),
    textOrigin: "saved",
    text: displayScriptSceneText(scene),
    textAnchorKey: anchorPairKey(anchors),
    editorRevision,
  };
}

/**
 * Pure draft transitions. Actions that depend on the derived view (anchors in
 * effect, the capture) carry it as payload from the committed view.
 */
function reduceDraft(draft, action) {
  switch (action.type) {
    case "reset":
      return { ...createEmptyDraft(draft.generation + 1), editorRevision: draft.editorRevision + 1 };

    case "loadScene":
      return draftFromScene(action.scene, draft.editorRevision + 1, draft.generation + 1);

    case "saveComplete":
      if (draft.generation !== action.snapshot.generation) return draft;
      if (draft === action.snapshot) {
        return draftFromScene(action.scene, draft.editorRevision + 1, draft.generation + 1);
      }
      // Acknowledge the saved version without replacing newer local edits.
      // For a first save, keep its id so the next save updates this record.
      return { ...draft, savedScene: action.scene };

    case "deleteComplete":
      if (draft.savedScene?.id !== action.sceneId) return draft;
      if (draft === action.snapshot) {
        return { ...createEmptyDraft(draft.generation + 1), editorRevision: draft.editorRevision + 1 };
      }
      // The row is gone, but changes made while deleting belong to the admin.
      // Preserve them as a new draft rather than clearing or updating a deleted row.
      return {
        ...draft,
        generation: draft.generation + 1,
        savedScene: null,
        textOrigin: draft.textOrigin === "saved" ? "edited" : draft.textOrigin,
      };

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

    case "editText":
      return {
        ...draft,
        text: action.text,
        textOrigin: "edited",
        textAnchorKey: action.anchorKey ?? draft.textAnchorKey,
      };

    case "recapture":
      return {
        ...withAnchors(draft, withoutSuggestions(action.anchors)),
        textOrigin: "capture",
        text: action.capture.markdown,
        textAnchorKey: action.capture.key,
        editorRevision: draft.editorRevision + 1,
      };

    case "proposalStart":
      return {
        ...draft,
        proposal: {
          token: action.token,
          anchorKey: action.anchorKey,
          capturedPlainText: action.capturedPlainText,
          status: "loading",
          markdown: "",
          error: "",
        },
      };

    case "proposalReady":
      if (draft.proposal?.token !== action.token) return draft;
      return { ...draft, proposal: { ...draft.proposal, status: "ready", markdown: action.markdown } };

    case "proposalFailed":
      if (draft.proposal?.token !== action.token) return draft;
      return { ...draft, proposal: { ...draft.proposal, status: "error", error: action.error } };

    case "proposalDiscard":
      return { ...draft, proposal: null };

    case "proposalAccept":
      if (draft.proposal?.status !== "ready") return draft;
      // Keyed to the selection the proposal was requested for, so the text is
      // stale if a capture now exists under a different anchor pair.
      return {
        ...draft,
        text: draft.proposal.markdown,
        textOrigin: "ai",
        textAnchorKey: draft.proposal.anchorKey,
        editorRevision: draft.editorRevision + 1,
        proposal: null,
      };

    default:
      return draft;
  }
}

/**
 * A new draft is dirty once it has any explicit anchor, text, time or tag. A
 * saved scene's draft is dirty when its times, tags (in order), text or
 * explicit anchor pair differ from the saved scene.
 */
function isDraftDirty(draft, text) {
  if (!draft.savedScene?.id) {
    return hasAnyAnchor(draft.anchors) || Boolean(text.trim() || draft.startTime || draft.endTime || draft.tags.length);
  }

  const scene = draft.savedScene;
  return (
    draft.startTime !== timeField(scene.start_time_seconds) ||
    draft.endTime !== timeField(scene.end_time_seconds) ||
    draft.tags.join("|") !== safeScriptSceneTags(scene.tags).join("|") ||
    text !== displayScriptSceneText(scene) ||
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

const CAPTURE_UNAVAILABLE_ERRORS = {
  start: "Place a start anchor in the script before saving.",
  end: "Place an end anchor in the script before saving.",
  indexing: "Wait for the pages between the anchors to finish indexing, then save again.",
  unreadable: "The script text between the anchors can't be read. Move the anchors to lines with text, then save again.",
};

/**
 * What saving the draft would store, or why it can't be saved: film timing is
 * checked first, then that explicit anchors have a capture, then text, then
 * script location.
 *
 * With explicit anchors the script location comes from the capture, and saving
 * is refused without one, so the saved location always matches the anchors
 * shown. Without explicit anchors (none, or only suggested ones) a saved scene
 * keeps its stored location. Raw text follows the location: the capture's
 * plain text, else the saved scene's raw text, else plain text derived from
 * the scene text. The scene text is saved as it is, even when stale.
 */
function buildSavePayload(draft, textIndex, capture, text, runtimeSeconds = 0) {
  const timingError = getTimingError(draft.startTime, draft.endTime, runtimeSeconds, { requireBoth: true });
  if (timingError) {
    return { error: timingError };
  }
  // Explicit anchors are never combined with suggestions, so the capture is theirs.
  const useCapture = hasAnyAnchor(draft.anchors);
  if (useCapture && !capture) {
    return { error: CAPTURE_UNAVAILABLE_ERRORS[captureUnavailableReason(textIndex, draft.anchors)] };
  }
  const start = parseTimeInputToSeconds(draft.startTime);
  const end = parseTimeInputToSeconds(draft.endTime);
  if (!text.trim()) {
    return { error: "Place start and end anchors in the script to capture the scene text." };
  }

  const savedScene = draft.savedScene;
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
  } else if (savedScene) {
    location = {
      page_start: savedScene.page_start ?? null,
      page_end: savedScene.page_end ?? null,
      start_offset: savedScene.start_offset ?? null,
      end_offset: savedScene.end_offset ?? null,
      context_prefix: savedScene.context_prefix ?? null,
      context_suffix: savedScene.context_suffix ?? null,
      anchor_geometry: Array.isArray(savedScene.anchor_geometry) ? savedScene.anchor_geometry : [],
    };
  }

  if (!location) {
    return { error: "Place start and end anchors in the script to capture the scene text." };
  }

  return {
    payload: {
      start_time_seconds: start,
      end_time_seconds: end,
      selected_text: text,
      raw_selected_text: useCapture
        ? capture.plainText
        : savedScene?.raw_selected_text || screenplayToPlainText(text),
      formatted_selected_text: text,
      ...location,
      tags: draft.tags,
    },
  };
}

function recaptureOptionFor(capture, textStale, textOrigin) {
  if (!capture) return "none";
  if (textStale) return "recapture";
  return textOrigin === "capture" ? "none" : "revert";
}

/**
 * The scene draft being captured or edited in the script viewer: its state
 * transitions and what saving it would store.
 *
 * `draft` is derived for the current committed render. `draftActions` keeps
 * one identity for the life of the hook, and each action reads the latest
 * committed draft when it is called, never an uncommitted render. Several
 * actions in one event therefore see the same draft, and `draft` shows their
 * changes once React commits them.
 *
 * @param textIndex the value returned by useScriptTextIndex(pdfDocument)
 * @returns [draft, draftActions]
 */
export function useSceneDraft(textIndex) {
  const [state, dispatch] = useReducer(reduceDraft, undefined, createEmptyDraft);

  const suggestedAnchors = useMemo(
    () =>
      state.savedScene && !state.suggestionsDismissed && !hasAnyAnchor(state.anchors)
        ? suggestAnchorsFromSavedText(state.savedScene, textIndex.pages)
        : null,
    [state.savedScene, state.suggestionsDismissed, state.anchors, textIndex.pages]
  );
  const anchors = suggestedAnchors || state.anchors;
  const capture = useMemo(() => captureAnchoredRange(textIndex, anchors), [textIndex, anchors]);

  const text = state.textOrigin === "capture" ? capture?.markdown ?? "" : state.text;
  const textStale = Boolean(capture) && state.textOrigin !== "capture" && capture.key !== state.textAnchorKey;
  const editorSeed = state.textOrigin === "capture" ? capture?.key ?? "" : state.textAnchorKey;

  const previewScene = useMemo(
    () => ({
      start_time_seconds: parseTimeInputToSeconds(state.startTime),
      end_time_seconds: parseTimeInputToSeconds(state.endTime),
      page_start: capture?.pageStart ?? state.savedScene?.page_start ?? null,
      page_end: capture?.pageEnd ?? state.savedScene?.page_end ?? null,
      tags: state.tags,
      formatted_selected_text: text,
    }),
    [state.startTime, state.endTime, state.savedScene, state.tags, capture, text]
  );

  // The request token and requested selection stay private.
  const proposal = useMemo(
    () =>
      state.proposal
        ? {
            status: state.proposal.status,
            markdown: state.proposal.markdown,
            error: state.proposal.error,
            capturedPlainText: state.proposal.capturedPlainText,
          }
        : null,
    [state.proposal]
  );

  // Assigned after every commit, never during render, so actions only see committed drafts.
  const latestRef = useRef(null);
  const tokenRef = useRef(0);
  useLayoutEffect(() => {
    latestRef.current = { state, textIndex, anchors, capture, text };
  });

  const [draftActions] = useState(() => ({
    /** Replaces the draft with a saved scene. */
    loadScene(scene) {
      dispatch({ type: "loadScene", scene });
    },

    /** Starts a new, empty draft. */
    reset() {
      dispatch({ type: "reset" });
    },

    /** Places a start or end anchor on an indexed line; does nothing for unindexed pages. */
    setAnchorAtLine(kind, pageNumber, line) {
      const { textIndex: index, anchors: current } = latestRef.current;
      const page = index.pages.get(pageNumber);
      if (!page || !line) return;
      dispatch({ type: "setAnchor", kind, anchor: createLineAnchor(page, line), currentAnchors: current });
    },

    removeAnchor(kind) {
      dispatch({ type: "removeAnchor", kind, currentAnchors: latestRef.current.anchors });
    },

    /** Removes explicit anchors and dismisses suggestions until another scene loads. */
    clearAnchors() {
      dispatch({ type: "clearAnchors" });
    },

    undoAnchors() {
      dispatch({ type: "undoAnchors" });
    },

    setTime(field, value) {
      dispatch({ type: "setTime", field, value });
    },

    /** Reformats a parseable time as HH:MM:SS and leaves anything else as typed. */
    normalizeTime(field) {
      const seconds = parseTimeInputToSeconds(latestRef.current.state[field]);
      if (seconds !== null) {
        dispatch({ type: "setTime", field, value: formatSecondsToHms(seconds, { fallback: "00:00:00" }) });
      }
    },

    toggleTag(tag) {
      dispatch({ type: "toggleTag", tag });
    },

    clearTags() {
      dispatch({ type: "clearTags" });
    },

    /** Replaces the scene text by hand; the first edit keeps the captured text's anchor key. */
    editText(markdown) {
      const { state: current, capture: currentCapture } = latestRef.current;
      dispatch({
        type: "editText",
        text: markdown,
        anchorKey: current.textOrigin === "capture" ? currentCapture?.key : undefined,
      });
    },

    /** Replaces the text with fresh captured text and makes the anchors in effect explicit. */
    recapture() {
      const { anchors: current, capture: currentCapture } = latestRef.current;
      if (!currentCapture) return;
      dispatch({ type: "recapture", anchors: current, capture: currentCapture });
    },

    /**
     * Starts an AI proposal and returns what to send, or null (changing
     * nothing) when there is no text to format. The proposal keeps the
     * selection it was requested from: the capture's anchor key and plain text,
     * or, without a capture, the draft text's own anchor key and no word check.
     */
    startProposal() {
      const { state: current, anchors: currentAnchors, capture: currentCapture, text: currentText } = latestRef.current;
      const capturedText = currentCapture?.plainText || screenplayToPlainText(currentText);
      if (!capturedText.trim()) return null;

      tokenRef.current += 1;
      const token = tokenRef.current;
      dispatch({
        type: "proposalStart",
        token,
        anchorKey: currentCapture ? currentCapture.key : current.textAnchorKey,
        capturedPlainText: currentCapture?.plainText ?? "",
      });
      return {
        token,
        capturedText,
        draftMarkdown: currentText,
        pageStart: currentCapture?.pageStart ?? current.savedScene?.page_start ?? null,
        pageEnd: currentCapture?.pageEnd ?? current.savedScene?.page_end ?? null,
        snapshotAnchors: currentCapture ? currentAnchors : null,
      };
    },

    /** Applies only if `token` belongs to the current proposal. */
    proposalReady(token, markdown) {
      dispatch({ type: "proposalReady", token, markdown });
    },

    /** Applies only if `token` belongs to the current proposal. */
    proposalFailed(token, message) {
      dispatch({ type: "proposalFailed", token, error: message });
    },

    /** Uses a ready proposal as the text, keyed to the selection its request was made from. */
    acceptProposal() {
      dispatch({ type: "proposalAccept" });
    },

    discardProposal() {
      dispatch({ type: "proposalDiscard" });
    },

    /**
     * Returns `{ error }` or `{ payload, applySaved }` for the committed draft.
     * Call applySaved with the server response. It reconciles the saved baseline
     * only if this draft is still open, preserving changes made during the request.
     */
    buildSave(runtimeSeconds) {
      const { state: current, textIndex: index, capture: currentCapture, text: currentText } = latestRef.current;
      const result = buildSavePayload(current, index, currentCapture, currentText, runtimeSeconds);
      if (result.error) return result;
      return {
        ...result,
        applySaved: (scene) => dispatch({ type: "saveComplete", scene, snapshot: current }),
      };
    },

    /** Returns a completion callback for deleting a scene without erasing another draft. */
    prepareDelete(sceneId) {
      const snapshot = latestRef.current.state;
      return () => dispatch({ type: "deleteComplete", sceneId, snapshot });
    },
  }));

  const draft = {
    savedScene: state.savedScene,
    anchors,
    anchorsSuggested: Boolean(suggestedAnchors),
    canUndoAnchors: state.anchorHistory.length > 0,
    startTime: state.startTime,
    endTime: state.endTime,
    tags: state.tags,
    text,
    textOrigin: state.textOrigin,
    textStale,
    legacyText: state.textOrigin === "saved" && !state.textAnchorKey,
    capturedPlainText: capture && !textStale ? capture.plainText : "",
    recaptureOption: recaptureOptionFor(capture, textStale, state.textOrigin),
    recaptureReplacesEdits: Boolean(capture) && (state.textOrigin === "edited" || state.textOrigin === "ai"),
    editorKey: `${state.editorRevision}:${editorSeed}`,
    proposal,
    previewScene,
    dirty: isDraftDirty(state, text),
  };

  return [draft, draftActions];
}
