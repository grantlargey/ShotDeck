import { createAnnotation, updateAnnotation } from "@/shared/api/annotations.js";
import { uploadMediaFile } from "@/shared/api/uploads.js";
import { ValidationError } from "@/shared/lib/errors.js";

/** One open editor's still save. Retain acknowledged work and replay uncertain
 * creation with the original input before applying any changed input.
 * Closing the editor discards this function; no recovery is stored on disk.
 */
export function createStillSave({ movieId, stillId = null }) {
  const id = stillId || crypto.randomUUID();
  let created = Boolean(stillId);
  let creation;
  let uploaded;
  let saved;
  let result;
  let saving = false;

  async function finishCreation() {
    result = await createAnnotation({ movieId, id, ...creation });
    if (result?.id !== id) throw new Error("Still creation returned an unexpected identity");
    created = true;
    // Replaying creation returns the current still. Use the submitted baseline
    // so an unchanged retry does not undo somebody else's subsequent edits.
    saved = creation;
  }

  return async function save({ timeSeconds, imageKey = null, file = null }) {
    if (saving) throw new ValidationError("A still save is already in progress.");
    saving = true;
    try {
      if (creation && !created) await finishCreation();
      if (file) {
        if (uploaded?.file !== file) uploaded = { file, uploadId: crypto.randomUUID(), key: null };
        if (!uploaded.key) {
          uploaded.key = await uploadMediaFile({ movieId, type: "annotation", file, uploadId: uploaded.uploadId });
          if (!uploaded.key) throw new Error("Upload returned no object key");
        }
        imageKey = uploaded.key;
      }
      const input = { timeSeconds, imageKey };
      if (!created) {
        creation = input;
        await finishCreation();
      }
      if (!saved || saved.timeSeconds !== timeSeconds || saved.imageKey !== imageKey) {
        result = await updateAnnotation({ movieId, annotationId: id, ...input });
        saved = input;
      }
      return result;
    } finally {
      saving = false;
    }
  };
}
