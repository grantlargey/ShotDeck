import { useMemo, useSyncExternalStore } from "react";
import { createMovie, updateMovie, updateMovieCover } from "@/shared/api/movies.js";
import { saveScript } from "@/shared/api/scripts.js";
import { uploadMediaFile } from "@/shared/api/uploads.js";
import { ValidationError } from "@/shared/lib/errors.js";
import { openSaveJournal } from "@/shared/lib/saveJournal.js";
import { buildMovieSavePayload } from "./movieForms.js";

const PREFIX = "scriptdeck:film-save:v3:";
const STORAGE_ERROR = "Unable to store film-save recovery. Allow site storage and try again.";
const CHANGED_ERROR = "This film save changed in another page. Reload before continuing.";
const MAX_SCRIPT_PAGES = 300;

// The journal's six steps: the film's details, created once and then kept up to
// date, and an upload and an attachment apiece for the cover and the script.
const DETAILS = "details";
const MEDIA = ["cover", "script"];
const SAVED = { [DETAILS]: "Film details saved.", cover: "Cover saved.", script: "Script saved." };
const INTERRUPTED = {
  "details:create": "Film creation",
  "details:update": "Film details save",
  "cover:upload": "Cover upload",
  "cover:update": "Cover save",
  "script:upload": "Script upload",
  "script:update": "Script save",
};

// The stored record wraps the journal in what only this page can supply again:
// which film the progress belongs to, and the details the admin had entered.
function readEnvelope(value) {
  if (!value) return null;
  const envelope = JSON.parse(value);
  if (
    envelope.version !== 3 || typeof envelope.movieId !== "string" ||
    !envelope.journal || typeof envelope.journal !== "object" ||
    (envelope.form !== null && (typeof envelope.form !== "object" || Array.isArray(envelope.form)))
  ) throw new Error("Invalid film-save recovery record");
  return envelope;
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

// pdf.js is imported on demand, so visitors who never attach a script never
// download the renderer.
async function readPdfPageCount(file) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc ||= worker.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    return (await task.promise).numPages;
  } finally {
    task.destroy().catch(() => {});
  }
}

// Nothing stores a script's length, but reading it before the upload refuses a
// PDF the viewer could not open, and one longer than a scene anchor's page can
// address, while the file chooser is still in front of the admin.
async function checkScriptPdf(file) {
  let pageCount;
  try {
    pageCount = await readPdfPageCount(file);
  } catch {
    pageCount = 0;
  }
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new ValidationError("That script PDF could not be read. Choose a different file.");
  }
  if (pageCount > MAX_SCRIPT_PAGES) {
    throw new ValidationError(`A script can be at most ${MAX_SCRIPT_PAGES} pages. That PDF has ${pageCount}.`);
  }
}

function createSave({ movieId, ownerId }) {
  const ownStorageKey = `${PREFIX}${ownerId}:${movieId || "new"}`;
  let storageKey = ownStorageKey;
  let stored = null;
  let loadError = null;
  let filmId = movieId || crypto.randomUUID();
  let form = null;
  let journal = null;
  const listeners = new Set();

  // Site storage is the journal's keeper, and this is the only place that knows
  // it: a record another page has moved on from is refused rather than overwritten.
  function persist(record) {
    try {
      if (localStorage.getItem(storageKey) !== stored) throw new ValidationError(CHANGED_ERROR);
      const next = record ? JSON.stringify({ version: 3, movieId: filmId, form, journal: record }) : null;
      if (next === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, next);
      stored = next;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(STORAGE_ERROR);
    }
    publish();
  }

  function openJournal(record) {
    return openSaveJournal({ name: "film save", created: Boolean(movieId), record, commit: persist });
  }

  if (ownerId) {
    try {
      stored = localStorage.getItem(storageKey);
      let envelope = readEnvelope(stored);
      // A partially created film can also be resumed from its edit page.
      if (!envelope && movieId) {
        const pendingKey = `${PREFIX}${ownerId}:new`;
        const pending = localStorage.getItem(pendingKey);
        const pendingEnvelope = readEnvelope(pending);
        if (pendingEnvelope?.movieId === movieId) {
          storageKey = pendingKey;
          stored = pending;
          envelope = pendingEnvelope;
        }
      }
      if (envelope && movieId && envelope.movieId !== movieId) throw new Error("Film identity mismatch");
      if (envelope) {
        filmId = envelope.movieId;
        form = envelope.form;
        journal = openJournal(envelope.journal);
      }
    } catch {
      loadError = "Unable to read film-save recovery. Restore this browser's site storage before continuing.";
    }
  }
  journal ??= openJournal(null);

  function snapshot() {
    const { saving, acknowledged, awaiting, outstanding } = journal.progress();
    const interrupted = outstanding && INTERRUPTED[`${outstanding.step}:${outstanding.kind}`];
    return {
      saving,
      recovery: stored || loadError ? {
        movieId: filmId,
        form,
        message: loadError || [
          ...(interrupted ? [`${interrupted} did not finish.`] : []),
          ...Object.entries(SAVED).flatMap(([step, sentence]) => (acknowledged.includes(step) ? [sentence] : [])),
          ...awaiting.map(({ name }) => `Choose “${name}” again to continue.`),
          "Retry to finish this film save.",
        ].join(" "),
      } : null,
    };
  }
  let view = snapshot();
  function publish() {
    view = snapshot();
    for (const listener of listeners) listener();
  }

  // Everything acknowledged is on the film itself by now, so the record is the
  // only thing left to drop, and the next save is a fresh film.
  function forget() {
    persist(null);
    filmId = movieId || crypto.randomUUID();
    form = null;
    storageKey = ownStorageKey;
    journal = openJournal(null);
    publish();
  }

  async function save({ form: entered, coverFile, scriptFile } = {}) {
    const attempt = journal.attempt(async () => {
      if (!ownerId) throw new ValidationError("Sign in to save this film.");
      if (loadError) throw new ValidationError(loadError);
      // Validate all selected input before any write, including creation.
      if (coverFile && !["image/jpeg", "image/png"].includes(coverFile.type)) {
        throw new ValidationError("Please choose a JPG or PNG cover image.");
      }
      if (scriptFile && scriptFile.type !== "application/pdf") {
        throw new ValidationError("Please choose a PDF file for the script.");
      }
      const nextForm = entered ?? form;
      const payload = nextForm ? buildMovieSavePayload(nextForm) : null;
      if (!movieId && !stored && !payload) throw new ValidationError("Enter the film details first.");

      // Hashing happens under the attempt guard, so a double submit cannot start
      // a second film or allocate another upload identity.
      const selected = [];
      for (const [kind, file] of [["cover", coverFile], ["script", scriptFile]]) {
        if (file) selected.push([kind, file, await fingerprint(file)]);
      }
      if (scriptFile) await checkScriptPdf(scriptFile);
      form = nextForm ? { ...nextForm } : null;
      for (const [kind, file, identity] of selected) {
        journal.select(kind, { identity, name: file.name, body: file });
      }

      await journal.settle(DETAILS, payload, {
        create: async (details) => {
          const film = await createMovie({ ...details, id: filmId });
          if (film?.id !== filmId) throw new Error("Film creation returned an unexpected identity");
          return film;
        },
        update: (details) => updateMovie(filmId, details),
      });

      const awaiting = new Map(journal.progress().awaiting.map(({ step, name }) => [step, name]));
      let script;
      for (const kind of MEDIA) {
        const name = awaiting.get(kind);
        if (name) throw new ValidationError(`Choose “${name}” again to finish this film save.`);
        const key = await journal.upload(kind, ({ uploadId, body }) =>
          uploadMediaFile({ movieId: filmId, type: kind, file: body, uploadId })
        );
        if (!key) continue;
        const attached = await journal.settle(kind, key, {
          update: (objectKey) => (
            kind === "cover" ? updateMovieCover(filmId, objectKey) : saveScript({ movieId: filmId, key: objectKey })
          ),
        });
        if (kind === "script") script = attached;
      }
      return { movieId: filmId, script };
    });

    publish();
    try {
      const result = await attempt;
      forget();
      return result;
    } finally {
      publish();
    }
  }

  return {
    save,
    leave() {
      if (journal.progress().saving) throw new ValidationError("Wait for the film save to finish before leaving.");
      forget();
      loadError = null;
      publish();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return view; },
  };
}

/**
 * One film save, including its durable progress and retry lifecycle. Pages
 * supply current input and present recovery; requests and site storage stay
 * private. File bytes and signed URLs are never stored in the journal.
 */
export function useFilmSave({ movieId = null, ownerId }) {
  const save = useMemo(() => createSave({ movieId, ownerId }), [movieId, ownerId]);
  const view = useSyncExternalStore(save.subscribe, save.getSnapshot);
  return { ...view, save: save.save, leave: save.leave };
}
