import { useMemo, useSyncExternalStore } from "react";
import { createMovie, updateMovie, updateMovieCover } from "@/shared/api/movies.js";
import { saveScript } from "@/shared/api/scripts.js";
import { uploadMediaFile } from "@/shared/api/uploads.js";
import { ValidationError } from "@/shared/lib/errors.js";
import { buildMovieSavePayload } from "./movieForms.js";

const PREFIX = "scriptdeck:film-save:v1:";
const STORAGE_ERROR = "Unable to store film-save recovery. Allow site storage and try again.";
const CHANGED_ERROR = "This film save changed in another page. Reload before continuing.";

function readJob(value) {
  if (!value) return null;
  const job = JSON.parse(value);
  if (
    job.version !== 1 || typeof job.movieId !== "string" || typeof job.created !== "boolean" ||
    (job.form !== null && (typeof job.form !== "object" || Array.isArray(job.form))) ||
    !["cover", "script"].every((kind) => job[kind] === null || (
      typeof job[kind]?.uploadId === "string" && typeof job[kind]?.fingerprint === "string" &&
      typeof job[kind]?.name === "string" && typeof job[kind]?.attached === "boolean" &&
      (job[kind]?.key === null || typeof job[kind]?.key === "string")
    ))
  ) throw new Error("Invalid film-save recovery record");
  return job;
}

// Content identity lets a reselected file reuse an interrupted upload, while
// a replacement with the same filename gets its own object key.
async function fingerprint(file) {
  const bytes = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `${file.type}:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function createSave({ movieId, ownerId }) {
  const ownStorageKey = `${PREFIX}${ownerId}:${movieId || "new"}`;
  let storageKey = ownStorageKey;
  let stored = null;
  let job = null;
  let loadError = null;
  let saving = false;
  let failure = "";
  let files = {};
  const listeners = new Set();

  if (ownerId) {
    try {
      stored = localStorage.getItem(storageKey);
      job = readJob(stored);
      // A partially created film can also be resumed from its edit page.
      if (!job && movieId) {
        const pendingKey = `${PREFIX}${ownerId}:new`;
        const pending = localStorage.getItem(pendingKey);
        const pendingJob = readJob(pending);
        if (pendingJob?.movieId === movieId) {
          storageKey = pendingKey;
          stored = pending;
          job = pendingJob;
        }
      }
      if (job && movieId && job.movieId !== movieId) throw new Error("Film identity mismatch");
    } catch {
      loadError = "Unable to read film-save recovery. Restore this browser's site storage before continuing.";
    }
  }

  function snapshot() {
    const completed = [];
    if (job?.savedPayload) completed.push("Film details saved.");
    if (job?.cover?.attached) completed.push("Cover saved.");
    if (job?.script?.attached) completed.push("Script saved.");
    const missing = ["cover", "script"].flatMap((kind) => {
      const media = job?.[kind];
      return media && !media.key && !files[kind] ? [`Choose “${media.name}” again to continue.`] : [];
    });
    return {
      saving,
      recovery: job || loadError ? {
        movieId: job?.movieId ?? movieId,
        form: job?.form ?? null,
        message: loadError || [failure, ...completed, ...missing, "Retry to finish this film save."].filter(Boolean).join(" "),
      } : null,
    };
  }
  let view = snapshot();
  function publish() {
    view = snapshot();
    for (const listener of listeners) listener();
  }

  function checkpoint(remove = false) {
    try {
      if (localStorage.getItem(storageKey) !== stored) throw new ValidationError(CHANGED_ERROR);
      const next = remove ? null : JSON.stringify(job);
      if (remove) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, next);
      stored = next;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(STORAGE_ERROR);
    }
    publish();
  }

  async function save({ form, coverFile, scriptFile } = {}) {
    if (saving) throw new ValidationError("A film save is already in progress.");
    if (!ownerId) throw new ValidationError("Sign in to save this film.");
    if (loadError) throw new ValidationError(loadError);
    // Validate all selected input before any write, including creation.
    if (coverFile && !["image/jpeg", "image/png"].includes(coverFile.type)) {
      throw new ValidationError("Please choose a JPG or PNG cover image.");
    }
    if (scriptFile && scriptFile.type !== "application/pdf") {
      throw new ValidationError("Please choose a PDF file for the script.");
    }
    const nextForm = form ?? job?.form;
    const payload = nextForm ? buildMovieSavePayload(nextForm) : null;
    if (!movieId && !job && !payload) throw new ValidationError("Enter the film details first.");

    saving = true;
    failure = "";
    publish();
    let phase = "";
    try {
      // Hashing happens under the save guard, so a double submit cannot start
      // a second film or allocate another upload identity.
      const selected = {};
      for (const [kind, file] of [["cover", coverFile], ["script", scriptFile]]) {
        if (file) selected[kind] = { file, fingerprint: await fingerprint(file) };
      }
      job ??= {
        version: 1, movieId: movieId || crypto.randomUUID(), created: Boolean(movieId),
        form: null, creationPayload: null, savedPayload: null, cover: null, script: null,
      };
      job.form = nextForm ? { ...nextForm } : null;
      for (const [kind, selectedFile] of Object.entries(selected)) {
        files[kind] = selectedFile.file;
        if (job[kind]?.fingerprint !== selectedFile.fingerprint) {
          job[kind] = {
            name: selectedFile.file.name, fingerprint: selectedFile.fingerprint,
            uploadId: crypto.randomUUID(), key: null, attached: false,
          };
        }
      }
      // Persist both the film identity and original creation payload before
      // the first request. A lost response can then be replayed after reload.
      if (!job.created) job.creationPayload ??= payload;
      checkpoint();

      if (!job.created) {
        phase = "Film creation";
        const created = await createMovie({ ...job.creationPayload, id: job.movieId });
        if (created?.id !== job.movieId) throw new Error("Film creation returned an unexpected identity");
        job.created = true;
        // Creation replay returns the current film. Remember the submitted
        // baseline, so recovery does not undo somebody's subsequent edits.
        job.savedPayload = job.creationPayload;
        checkpoint();
      }
      if (payload && JSON.stringify(job.savedPayload) !== JSON.stringify(payload)) {
        phase = "Film details save";
        await updateMovie(job.movieId, payload);
        job.savedPayload = payload;
        checkpoint();
      }

      let script;
      for (const kind of ["cover", "script"]) {
        phase = "";
        const media = job[kind];
        if (!media || media.attached) continue;
        if (!media.key) {
          if (!files[kind]) throw new ValidationError(`Choose “${media.name}” again to finish this film save.`);
          phase = kind === "cover" ? "Cover upload" : "Script upload";
          media.key = await uploadMediaFile({ movieId: job.movieId, type: kind, file: files[kind], uploadId: media.uploadId });
          if (!media.key) throw new Error("Upload returned no object key");
          checkpoint();
        }
        phase = kind === "cover" ? "Cover save" : "Script save";
        if (kind === "cover") {
          await updateMovieCover(job.movieId, media.key);
        } else {
          script = await saveScript({ movieId: job.movieId, key: media.key });
        }
        media.attached = true;
        checkpoint();
      }
      const result = { movieId: job.movieId, script };
      checkpoint(true);
      job = null;
      files = {};
      storageKey = ownStorageKey;
      return result;
    } catch (error) {
      if (phase) failure = `${phase} did not finish.`;
      throw error;
    } finally {
      saving = false;
      publish();
    }
  }

  return {
    save,
    leave() {
      if (saving) throw new ValidationError("Wait for the film save to finish before leaving.");
      checkpoint(true);
      job = null;
      loadError = null;
      files = {};
      failure = "";
      storageKey = ownStorageKey;
      publish();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return view; },
  };
}

/**
 * One film save, including its durable progress and retry lifecycle. Pages
 * supply current input and present recovery; requests and checkpoints stay
 * private. File bytes and signed URLs are never stored in the journal.
 */
export function useFilmSave({ movieId = null, ownerId }) {
  const save = useMemo(() => createSave({ movieId, ownerId }), [movieId, ownerId]);
  const view = useSyncExternalStore(save.subscribe, save.getSnapshot);
  return { ...view, save: save.save, leave: save.leave };
}
