import { ValidationError } from "./errors.js";

/**
 * One save's journal: what an admin's submission has already had acknowledged,
 * and what may still be replayed.
 *
 * A step is a named slot in the ledger. A step remembers only the input the API
 * has confirmed, so a retry carries what is outstanding and nothing else.
 *
 * The rules every adapter inherits:
 * - Nothing is sent before the record behind it has been handed to `commit`, so
 *   whatever a failed send may have done can be picked up again.
 * - The creating write is pinned to the first input offered for it. While its
 *   outcome is unknown it is replayed exactly as it was submitted; once the API
 *   has refused it, it is dropped, because a replay would be refused again and
 *   the next save should carry the corrected input.
 * - The input the API acknowledged is the step's baseline. Replaying a creation
 *   returns the record as it now stands, so the baseline is what was submitted
 *   and an unchanged retry sends nothing and cannot undo somebody's later edits.
 * - One upload identity per content identity, kept until its object key is
 *   acknowledged, so a reselected file finishes the upload it began instead of
 *   leaving a second object behind.
 * - One attempt at a time. That guard is what makes an identity minted during a
 *   save safe: a double submit cannot bring a second record into being or
 *   allocate a second upload identity.
 *
 * The record is the caller's to keep: a persistent adapter serialises it, an
 * in-memory one lets it go with the editor. It carries no bytes and no signed
 * URLs, so after a reload the file has to be offered again; until it is, the
 * step says so through `progress()`.
 */
export function openSaveJournal({ name, created = false, record = null, commit = () => {} }) {
  const ledger = readRecord(record, created);
  // The bytes an upload has in hand. They are deliberately outside the record:
  // a reload keeps the upload identity and asks the admin for the file again.
  const held = new Map();
  // What the API last said about each step, so a step that sends nothing still
  // answers with the record as the API last described it.
  const results = new Map();
  let saving = false;
  let outstanding = null;

  function slot(step) {
    ledger.steps[step] ??= { pinned: null, acknowledged: null, upload: null };
    return ledger.steps[step];
  }

  /** Every send is preceded by this, so nothing is attempted off the record. */
  function checkpoint() {
    commit(ledger);
  }

  async function attempt(run) {
    if (saving) throw new ValidationError(`A ${name} is already in progress.`);
    saving = true;
    outstanding = null;
    try {
      return await run();
    } finally {
      saving = false;
    }
  }

  /**
   * Brings a step to `input`: `create` brings the record into being, at most
   * once per journal, and `update` carries every later change to it. Neither is
   * sent while the step already stands where the input asks. A step asked for no
   * input only settles a creation left outstanding, which is how a caller gets
   * an uncertain creation answered before new input rides along with it.
   *
   * The step that brings the record into being is settled before any other, and
   * nothing here is awaited before the send goes out, so a caller that sends
   * nothing else reaches the API within its own turn.
   */
  async function settle(step, input, { create, update } = {}) {
    const entry = slot(step);
    if (!ledger.created && create) {
      entry.pinned ??= input ?? null;
      if (entry.pinned) {
        checkpoint();
        let born;
        try {
          born = await create(entry.pinned);
        } catch (error) {
          // A refusal is the API's verdict on the input, so replaying it would
          // be refused again: drop it and let the next save carry the corrected
          // input. An uncertain failure keeps it, to be replayed as it is.
          if (error?.status >= 400 && error?.status < 500) {
            entry.pinned = null;
            checkpoint();
          }
          outstanding = { step, kind: "create" };
          throw error;
        }
        ledger.created = true;
        entry.acknowledged = entry.pinned;
        results.set(step, born);
        checkpoint();
      }
    }
    if (input === null || input === undefined) return results.get(step);
    if (JSON.stringify(entry.acknowledged) === JSON.stringify(input)) return results.get(step);

    checkpoint();
    let result;
    try {
      result = await update(input);
    } catch (error) {
      outstanding = { step, kind: "update" };
      throw error;
    }
    entry.acknowledged = input;
    results.set(step, result);
    checkpoint();
    return result;
  }

  /**
   * The content an upload step carries: what identifies it, and the bytes while
   * they are in hand. Content the step has not seen before earns its own upload
   * identity, so a replacement that kept its filename gets its own object key.
   */
  function select(step, { identity, name: filename = null, body }) {
    const entry = slot(step);
    const fresh = entry.upload?.identity !== identity;
    if (fresh) entry.upload = { identity, name: filename, uploadId: crypto.randomUUID(), key: null };
    held.set(step, body);
  }

  /**
   * The step's object key, uploading the bytes in hand when the key is not known
   * yet. Undefined when the step carries no content at all. A step whose bytes
   * are gone must be caught through `progress()` first; asking for its key is a
   * mistake the caller cannot recover from.
   */
  async function upload(step, send) {
    const entry = slot(step).upload;
    if (!entry) return undefined;
    if (entry.key) return entry.key;
    if (!held.get(step)) throw new Error(`The ${step} upload has no content in hand`);

    checkpoint();
    let key;
    try {
      key = await send({ uploadId: entry.uploadId, body: held.get(step) });
      if (!key) throw new Error("Upload returned no object key");
    } catch (error) {
      outstanding = { step, kind: "upload" };
      throw error;
    }
    entry.key = key;
    checkpoint();
    return key;
  }

  /**
   * The parts a caller needs to report the save, never a sentence: which steps
   * the API has acknowledged, which uploads are waiting for their bytes, and
   * which step was outstanding when this attempt gave up.
   */
  function progress() {
    const steps = Object.entries(ledger.steps);
    return {
      saving,
      acknowledged: steps.flatMap(([step, entry]) => (entry.acknowledged === null ? [] : [step])),
      awaiting: steps.flatMap(([step, entry]) =>
        entry.upload && !entry.upload.key && !held.get(step) ? [{ step, name: entry.upload.name }] : []
      ),
      outstanding,
    };
  }

  return { attempt, settle, select, upload, progress };
}

function readStep(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid save-journal step");
  const upload = value.upload ?? null;
  if (
    upload !== null && !(
      typeof upload.identity === "string" && typeof upload.uploadId === "string" &&
      (upload.name === null || typeof upload.name === "string") &&
      (upload.key === null || typeof upload.key === "string")
    )
  ) throw new Error("Invalid save-journal upload");
  return { pinned: value.pinned ?? null, acknowledged: value.acknowledged ?? null, upload };
}

// A record comes back from wherever the adapter kept it, so it is read as
// untrusted input: a shape this journal did not write cannot be resumed.
function readRecord(record, created) {
  if (record === null || record === undefined) return { created, steps: {} };
  if (
    typeof record !== "object" || Array.isArray(record) || typeof record.created !== "boolean" ||
    !record.steps || typeof record.steps !== "object" || Array.isArray(record.steps)
  ) throw new Error("Invalid save-journal record");
  return {
    created: record.created,
    steps: Object.fromEntries(Object.entries(record.steps).map(([step, value]) => [step, readStep(value)])),
  };
}
