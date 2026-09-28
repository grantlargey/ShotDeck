import { useEffect, useRef, useState } from "react";
import { createStillSave } from "@/entities/annotation/model/stillSave.js";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors.js";
import { useFilePreviewUrl } from "@/shared/lib/media/useFilePreviewUrl.js";
import { formatSecondsToHms, normalizeTypedMoment } from "@/shared/lib/time.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Dialog } from "@/shared/ui/Dialog.jsx";
import { Field } from "@/shared/ui/Field.jsx";
import { FileDropzone } from "@/shared/ui/FileDropzone.jsx";
import { Input } from "@/shared/ui/Input.jsx";
import { readStillSeconds } from "./stillTimestamp.js";
import styles from "./AddStillDialog.module.css";

/**
 * Adding a still to the project. The dialog owns its form, its validation, its
 * busy and error state, and the save; the page decides only when it is open.
 * Mount it to open it: each mount starts an empty form on a fresh still save,
 * and a retry after a failure reuses that save, so the image goes up once and
 * the still keeps the identity the first attempt sent.
 *
 * Once the still is recorded the dialog closes and awaits `onAdded()`, which
 * refreshes the stills. A save that settles after the dialog has closed still
 * awaits `onAdded()`, but leaves a later dialog alone: it neither closes it nor
 * reports into it.
 *
 * `runtimeSeconds` plus one minute caps the timestamp; 0 means it is unknown.
 */
export function AddStillDialog({ movieId, runtimeSeconds, onAdded, onClose }) {
  const [time, setTime] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const previewUrl = useFilePreviewUrl(file);
  const [save] = useState(() => createStillSave({ movieId }));

  // A save outlives the dialog that started it. This is what keeps its ending
  // from reaching whatever dialog is open by then.
  const openRef = useRef(true);
  useEffect(() => () => {
    openRef.current = false;
  }, []);

  async function addStill(event) {
    event.preventDefault();
    if (busy) return;
    setError("");

    try {
      const timeSeconds = readStillSeconds(time, runtimeSeconds);
      if (!file) {
        throw new ValidationError("Choose a still image to add.");
      }

      setBusy(true);
      await save({ timeSeconds, file });
      if (openRef.current) onClose();
      await onAdded();
    } catch (e) {
      if (openRef.current) setError(getErrorMessage(e, "Failed to add the still."));
    } finally {
      if (openRef.current) setBusy(false);
    }
  }

  const hint = runtimeSeconds
    ? `Between 00:00:00 and ${formatSecondsToHms(Number(runtimeSeconds) + 60)} (includes one-minute allowance)`
    : "HH:MM:SS";

  return (
    <Dialog
      title="Add a film still"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-still-form" variant="primary" disabled={busy}>
            {busy ? "Adding…" : "Add still"}
          </Button>
        </>
      }
    >
      <form id="add-still-form" className={styles.addForm} onSubmit={addStill}>
        <FileDropzone
          disabled={busy}
          className={styles.addDrop}
          accept="image/*"
          file={file}
          onChange={(picked) => {
            setFile(picked);
            setError("");
          }}
          onReject={() => setError("That file isn't an image. Choose a JPG or PNG.")}
          title={file ? "Replace image" : "Drop a still here or click to choose"}
          hint="JPG or PNG"
          preview={previewUrl ? <img src={previewUrl} alt="" /> : null}
        />
        <Field
          label="Timestamp"
          required
          hint={`${hint}. Add a tenth, like 00:10:00.5, for a second shot in the same second.`}
        >
          <Input
            disabled={busy}
            placeholder="HH:MM:SS"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={(e) => setTime(normalizeTypedMoment(e.target.value))}
            required
          />
        </Field>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
