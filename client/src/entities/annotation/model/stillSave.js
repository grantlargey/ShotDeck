import { createAnnotation, updateAnnotation } from "@/shared/api/annotations.js";
import { uploadMediaFile } from "@/shared/api/uploads.js";
import { openSaveJournal } from "@/shared/lib/saveJournal.js";

// The journal's two steps: the still's image, and the record of its film moment.
const MOMENT = "moment";
const IMAGE = "image";

/** One open editor's still save. Retain acknowledged work and replay uncertain
 * creation with the original input before applying any changed input.
 * Closing the editor discards this function; no recovery is stored on disk.
 */
export function createStillSave({ movieId, stillId = null }) {
  const id = stillId || crypto.randomUUID();
  const journal = openSaveJournal({ name: "still save", created: Boolean(stillId) });

  async function create(input) {
    const still = await createAnnotation({ movieId, id, ...input });
    if (still?.id !== id) throw new Error("Still creation returned an unexpected identity");
    return still;
  }

  return async function save({ timeSeconds, imageKey = null, file = null }) {
    return journal.attempt(async () => {
      if (file) {
        // A creation whose outcome is unknown is answered before a replacement
        // image goes up, so this editor learns the still exists even when the
        // upload that follows fails again.
        await journal.settle(MOMENT, null, { create });
        journal.select(IMAGE, { identity: file, body: file });
        imageKey = await journal.upload(IMAGE, ({ uploadId, body }) =>
          uploadMediaFile({ movieId, type: "annotation", file: body, uploadId })
        );
      }
      return journal.settle(MOMENT, { timeSeconds, imageKey }, {
        create,
        update: (moment) => updateAnnotation({ movieId, annotationId: id, ...moment }),
      });
    });
  };
}
