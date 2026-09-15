import { useRef, useState } from "react";
import { parseFilmMoment } from "@/entities/script-scene/model/filmTiming.js";
import { createAnnotation, deleteAnnotation, updateAnnotation } from "@/shared/api/annotations.js";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors.js";
import { useFilePreviewUrl } from "@/shared/lib/media/useFilePreviewUrl.js";
import { formatSecondsToHms, normalizeTypedTime } from "@/shared/lib/time.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { Dialog } from "@/shared/ui/Dialog.jsx";
import { Field } from "@/shared/ui/Field.jsx";
import { FileDropzone } from "@/shared/ui/FileDropzone.jsx";
import { FileInput } from "@/shared/ui/FileInput.jsx";
import { Input } from "@/shared/ui/Input.jsx";
import { SceneModalButton } from "@/widgets/scene-detail-modal/ui/SceneDetailModal.jsx";
import styles from "./useStillEditor.module.css";

/** A typed still timestamp in seconds. Throws the film timing message for the form to show. */
function readStillSeconds(text, runtimeSeconds) {
  const { seconds, error } = parseFilmMoment(text, runtimeSeconds);
  if (error) throw new ValidationError(error);
  return seconds;
}

/**
 * Still editing on the project page: adding a still, changing a still's
 * timestamp, replacing its image, and deleting it. The editor owns the forms,
 * their validation, busy and error state, and the requests. After a still is
 * added, saved or deleted, it awaits `onChange()`, which refreshes the stills.
 * `runtimeSeconds` caps timestamps; 0 means the runtime is unknown.
 *
 * The page renders what it returns:
 * - `openAddDialog()` opens the add dialog with an empty form, and `addDialog`
 *   is that dialog, or null while it's closed. Errors from adding show in it.
 * - `renderActions` and `renderStillTools` fill the scene viewer's slots of the
 *   same names: Delete and Edit in the footer, and above the still, the edit
 *   form and the last edit or delete error. Delete and Save are disabled while
 *   a save or delete runs.
 * - `reset()` drops the edit, that error and the busy state. Call it when the
 *   viewer closes. A save or delete that settles after it still awaits
 *   `onChange()`, but leaves a later viewer session's state alone.
 */
export function useStillEditor({ movieId, runtimeSeconds, onChange }) {
  const [adding, setAdding] = useState(false);
  const [addTime, setAddTime] = useState("");
  const [addFile, setAddFile] = useState(null);
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const addPreviewUrl = useFilePreviewUrl(addFile);

  // The viewer's edit, tied to the still it edits so stepping to another still
  // never applies it to the wrong one.
  const [edit, setEdit] = useState(null);
  // The last edit or delete failure, shown above whichever still the viewer shows.
  const [error, setError] = useState("");
  // True while the viewer's save or delete runs, including the refresh after it.
  const [busy, setBusy] = useState(false);
  // Counts viewer sessions; reset() starts the next one.
  const viewerSessionRef = useRef(0);

  /** Returns a check that stays true until reset() starts another viewer session. */
  function trackViewerSession() {
    const session = viewerSessionRef.current;
    return () => viewerSessionRef.current === session;
  }

  function openAddDialog() {
    setAddTime("");
    setAddFile(null);
    setAddError("");
    setAdding(true);
  }

  async function addStill(event) {
    event.preventDefault();
    setAddError("");

    try {
      const timeSeconds = readStillSeconds(addTime, runtimeSeconds);
      if (!addFile) {
        throw new ValidationError("Choose a still image to add.");
      }

      setAddBusy(true);
      await createAnnotation({ movieId, timeSeconds, file: addFile });
      setAdding(false);
      await onChange();
    } catch (e) {
      setAddError(getErrorMessage(e, "Failed to add the still."));
    } finally {
      setAddBusy(false);
    }
  }

  function toggleEdit(still) {
    setEdit(
      edit?.stillId === still.id
        ? null
        : { stillId: still.id, time: formatSecondsToHms(still.time_seconds, { fallback: "00:00:00" }), file: null }
    );
  }

  async function saveEdit(still) {
    if (edit?.stillId !== still.id) return;
    const isSameSession = trackViewerSession();
    setError("");

    try {
      const timeSeconds = readStillSeconds(edit.time, runtimeSeconds);
      if (!still.image_key && !edit.file) {
        throw new ValidationError("Choose an image for this still.");
      }

      setBusy(true);
      await updateAnnotation({
        movieId,
        annotationId: still.id,
        timeSeconds,
        imageKey: still.image_key ?? null,
        file: edit.file,
      });

      await onChange();
      if (isSameSession()) setEdit(null);
    } catch (e) {
      if (isSameSession()) setError(getErrorMessage(e, "Failed to save the still."));
    } finally {
      if (isSameSession()) setBusy(false);
    }
  }

  async function deleteStill(still) {
    if (!window.confirm("Delete this still?")) return;
    const isSameSession = trackViewerSession();
    try {
      setBusy(true);
      await deleteAnnotation(movieId, still.id);
      if (isSameSession()) {
        setEdit(null);
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
    viewerSessionRef.current += 1;
    setEdit(null);
    setError("");
    setBusy(false);
  }

  function renderActions({ view, still }) {
    if (view !== "still" || !still) return null;
    return (
      <>
        <SceneModalButton variant="danger" disabled={busy} onClick={() => deleteStill(still)}>
          Delete
        </SceneModalButton>
        <SceneModalButton onClick={() => toggleEdit(still)}>
          {edit?.stillId === still.id ? "Cancel edit" : "Edit"}
        </SceneModalButton>
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
                placeholder="HH:MM:SS"
                value={edit.time}
                onChange={(e) => {
                  const value = e.target.value;
                  setEdit((current) => ({ ...current, time: value }));
                }}
                onBlur={(e) => {
                  const value = normalizeTypedTime(e.target.value);
                  setEdit((current) => ({ ...current, time: value }));
                }}
              />
            </Field>
            <Field as="div" label="Replace image" className={styles.imageField}>
              <FileInput
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

  const addDialog = adding ? (
    <Dialog
      title="Add a film still"
      onClose={() => setAdding(false)}
      footer={
        <>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
          <Button type="submit" form="add-still-form" variant="primary" disabled={addBusy}>
            {addBusy ? "Adding…" : "Add still"}
          </Button>
        </>
      }
    >
      <form id="add-still-form" className={styles.addForm} onSubmit={addStill}>
        <FileDropzone
          className={styles.addDrop}
          accept="image/*"
          file={addFile}
          onChange={(file) => {
            setAddFile(file);
            setAddError("");
          }}
          onReject={() => setAddError("That file isn't an image. Choose a JPG or PNG.")}
          title={addFile ? "Replace image" : "Drop a still here or click to choose"}
          hint="JPG or PNG"
          preview={addPreviewUrl ? <img src={addPreviewUrl} alt="" /> : null}
        />
        <Field
          label="Timestamp"
          required
          hint={runtimeSeconds ? `Between 00:00:00 and ${formatSecondsToHms(runtimeSeconds)}` : "HH:MM:SS"}
        >
          <Input
            placeholder="HH:MM:SS"
            value={addTime}
            onChange={(e) => setAddTime(e.target.value)}
            onBlur={(e) => setAddTime(normalizeTypedTime(e.target.value))}
            required
          />
        </Field>
        {addError && (
          <p className={styles.formError} role="alert">
            {addError}
          </p>
        )}
      </form>
    </Dialog>
  ) : null;

  return { openAddDialog, addDialog, renderActions, renderStillTools, reset };
}
