import { useRef, useState } from "react";
import { createStillSave } from "@/entities/annotation/model/stillSave.js";
import { deleteAnnotation } from "@/shared/api/annotations.js";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors.js";
import { formatMomentToHms, normalizeTypedMoment } from "@/shared/lib/time.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { Field } from "@/shared/ui/Field.jsx";
import { FileInput } from "@/shared/ui/FileInput.jsx";
import { Input } from "@/shared/ui/Input.jsx";
import { readStillSeconds } from "./stillTimestamp.js";
import styles from "./useStillEdit.module.css";

/**
 * Editing and deleting the still the scene viewer is showing. The editor owns
 * the form, its validation, busy and error state, and the requests. After a
 * still is saved or deleted it awaits `onChange()`, which refreshes the stills.
 * `runtimeSeconds` plus one minute caps timestamps; 0 means it is unknown.
 *
 * The page renders what it returns into the viewer's slots of the same names:
 * - `renderActions` puts Delete and Edit in the footer;
 * - `renderStillTools` puts the edit form, and the last failure, above the still.
 * Both are disabled while a save or delete runs.
 *
 * `reset()` drops the edit, the error and the busy state; call it when the
 * viewer closes. A save or delete that settles after it still awaits
 * `onChange()`, but leaves a later viewer session's state alone.
 */
export function useStillEdit({ movieId, runtimeSeconds, onChange }) {
  // The edit is tied to the still it edits, so stepping to another still in the
  // viewer never applies it to the wrong one.
  const [edit, setEdit] = useState(null);
  const saveRef = useRef(null);
  // The last save or delete failure, shown above whichever still the viewer shows.
  const [error, setError] = useState("");
  // True while a save or delete runs, including the refresh after it.
  const [busy, setBusy] = useState(false);
  // Counts viewer sessions; reset() starts the next one.
  const sessionRef = useRef(0);

  /** Returns a check that stays true until reset() starts another viewer session. */
  function trackSession() {
    const session = sessionRef.current;
    return () => sessionRef.current === session;
  }

  function toggleEdit(still) {
    const editingThisStill = edit?.stillId === still.id;
    saveRef.current = editingThisStill ? null : createStillSave({ movieId, stillId: still.id });
    setEdit(
      editingThisStill
        ? null
        : { stillId: still.id, time: formatMomentToHms(still.time_seconds, { fallback: "00:00:00" }), file: null }
    );
  }

  async function saveEdit(still) {
    if (edit?.stillId !== still.id || busy) return;
    const save = saveRef.current;
    if (!save) return;
    const isSameSession = trackSession();
    const isCurrent = () => isSameSession() && saveRef.current === save;
    setError("");

    try {
      const timeSeconds = readStillSeconds(edit.time, runtimeSeconds);
      if (!still.image_key && !edit.file) {
        throw new ValidationError("Choose an image for this still.");
      }

      setBusy(true);
      await save({
        timeSeconds,
        imageKey: still.image_key ?? null,
        file: edit.file,
      });

      await onChange();
      if (isCurrent()) {
        setEdit(null);
        saveRef.current = null;
        setBusy(false);
      }
    } catch (e) {
      if (isCurrent()) setError(getErrorMessage(e, "Failed to save the still."));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function removeStill(still) {
    if (!window.confirm("Delete this still?")) return;
    const isSameSession = trackSession();
    try {
      setBusy(true);
      await deleteAnnotation(movieId, still.id);
      if (isSameSession()) {
        setEdit(null);
        saveRef.current = null;
        setError("");
      }
      await onChange();
    } catch (e) {
      if (isSameSession()) setError(getErrorMessage(e, "Failed to delete the still."));
    } finally {
      if (isSameSession()) setBusy(false);
    }
  }

  function reset() {
    sessionRef.current += 1;
    saveRef.current = null;
    setEdit(null);
    setError("");
    setBusy(false);
  }

  function renderActions({ view, still }) {
    if (view !== "still" || !still) return null;
    return (
      <>
        <Button variant="danger" disabled={busy} onClick={() => removeStill(still)}>
          Delete
        </Button>
        <Button disabled={busy} onClick={() => toggleEdit(still)}>
          {edit?.stillId === still.id ? "Cancel edit" : "Edit"}
        </Button>
      </>
    );
  }

  function renderStillTools(still) {
    return (
      <>
        {error && <Callout tone="error">{error}</Callout>}
        {edit?.stillId === still.id && (
          <div className={styles.editRow}>
            <Field label="Timestamp" required className={styles.timeField}>
              <Input
                disabled={busy}
                placeholder="HH:MM:SS"
                value={edit.time}
                onChange={(e) => {
                  const value = e.target.value;
                  setEdit((current) => ({ ...current, time: value }));
                }}
                onBlur={(e) => {
                  const value = normalizeTypedMoment(e.target.value);
                  setEdit((current) => ({ ...current, time: value }));
                }}
              />
            </Field>
            <Field as="div" label="Replace image" className={styles.imageField}>
              <FileInput
                disabled={busy}
                accept="image/*"
                file={edit.file}
                onChange={(file) => setEdit((current) => ({ ...current, file }))}
                label="Choose image"
                placeholder="Keeps the current image"
              />
            </Field>
            <div className={styles.editActions}>
              <Button variant="primary" disabled={busy} onClick={() => saveEdit(still)}>
                Save
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  return { renderActions, renderStillTools, reset };
}
