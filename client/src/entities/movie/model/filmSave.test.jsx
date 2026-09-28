import { webcrypto } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilmSave } from "./filmSave.js";
import { buildMovieSavePayload } from "./movieForms.js";

const remote = vi.hoisted(() => ({ createMovie: vi.fn(), updateMovie: vi.fn(), updateMovieCover: vi.fn(), saveScript: vi.fn(), uploadMediaFile: vi.fn() }));
const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("@/shared/api/movies.js", () => ({ createMovie: remote.createMovie, updateMovie: remote.updateMovie, updateMovieCover: remote.updateMovieCover }));
vi.mock("@/shared/api/scripts.js", () => ({ saveScript: remote.saveScript }));
vi.mock("@/shared/api/uploads.js", () => ({ uploadMediaFile: remote.uploadMediaFile }));
// pdf.js itself is the external edge now that filmSave reads the page count.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-stub" }));

const form = { title: "Night Diner", director: "Ada Park", writer: "", cinematographer: "", year: "2024", runtime_hms: "02:00:00" };
const file = (text = "script") => new File([text], "script.pdf", { type: "application/pdf" });
const cover = () => new File(["cover"], "cover.png", { type: "image/png" });
const open = (props = {}) => renderHook(() => useFilmSave({ ownerId: "admin-1", ...props }));
const pdfPages = (numPages) => pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages }), destroy: async () => {} });
const pdfUnreadable = () => pdf.getDocument.mockImplementationOnce(() => ({ promise: Promise.reject(new Error("not a screenplay")), destroy: async () => {} }));

// The recovery the two earlier formats wrote, and the keys they wrote it under.
// Both shipped the same job, so a version number is all that tells them apart.
const legacyKey = (version, suffix = "new") => `scriptdeck:film-save:v${version}:admin-1:${suffix}`;
const currentKey = (suffix = "new") => `scriptdeck:film-save:v3:admin-1:${suffix}`;
const legacyJob = (version, job) => JSON.stringify({
  version, movieId: "film-uuid-1", created: false, form,
  creationPayload: null, savedPayload: null, cover: null, script: null, ...job,
});
// The content identity those releases stored, computed the way filmSave does.
async function contentIdentity(chosen) {
  const hash = await webcrypto.subtle.digest("SHA-256", await chosen.arrayBuffer());
  return `${chosen.type}:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function submit(hook, input) {
  let result;
  let error;
  await act(async () => {
    try { result = await hook.result.current.save(input); }
    catch (caught) { error = caught; }
  });
  return { result, error };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  for (const fn of Object.values(remote)) fn.mockReset();
  remote.createMovie.mockImplementation(async (body) => ({ ...body }));
  remote.updateMovie.mockResolvedValue({});
  remote.updateMovieCover.mockResolvedValue({});
  remote.uploadMediaFile.mockImplementation(async ({ movieId, type, uploadId }) => `${type}/${movieId}/${uploadId}`);
  remote.saveScript.mockImplementation(async ({ movieId, key }) => ({ id: "script-1", movie_id: movieId, s3_key: key }));
  pdf.getDocument.mockReset();
  pdfPages(118);
});
afterEach(() => vi.unstubAllGlobals());

describe("film-save recovery through the caller's interface", () => {
  it("keeps a created film and cover when the script upload fails, and retries only unfinished work", async () => {
    const scriptFile = file();
    const coverFile = cover();
    const upload = remote.uploadMediaFile.getMockImplementation();
    remote.uploadMediaFile.mockImplementationOnce(upload).mockRejectedValueOnce(new Error("offline"));
    const hook = open();
    expect((await submit(hook, { form, coverFile, scriptFile })).error.message).toBe("offline");
    expect(hook.result.current.recovery.message).toContain("Cover saved.");
    expect(hook.result.current.recovery.message).toContain("Script upload did not finish.");
    expect((await submit(hook, { form, coverFile, scriptFile })).error).toBeUndefined();
    expect(remote.createMovie).toHaveBeenCalledTimes(1);
    expect(remote.updateMovie).not.toHaveBeenCalled();
    expect(remote.updateMovieCover).toHaveBeenCalledTimes(1);
    expect(remote.uploadMediaFile.mock.calls.map(([args]) => args.type)).toEqual(["cover", "script", "script"]);
    expect(remote.uploadMediaFile.mock.calls[1][0].uploadId).toBe(remote.uploadMediaFile.mock.calls[2][0].uploadId);
    expect(localStorage.length).toBe(0);
    expect(hook.result.current.recovery).toBeNull();
  });

  it("replays a lost creation response after reload with the same identity and saved input", async () => {
    remote.createMovie.mockRejectedValueOnce(new Error("response lost"));
    const first = open();
    await submit(first, { form });
    const original = remote.createMovie.mock.calls[0][0];
    first.unmount();
    const recovered = open();
    expect(recovered.result.current.recovery.form).toEqual(form);
    expect((await submit(recovered, {})).error).toBeUndefined();
    expect(remote.createMovie.mock.calls[1][0]).toEqual(original);
    expect(localStorage.length).toBe(0);
  });

  it("keeps the original creation request on retry, then applies edited details", async () => {
    remote.createMovie.mockRejectedValueOnce(new Error("response lost"));
    const hook = open();
    await submit(hook, { form });
    await submit(hook, { form: { ...form, title: "Revised title" } });
    expect(remote.createMovie.mock.calls[1][0]).toEqual(remote.createMovie.mock.calls[0][0]);
    expect(remote.updateMovie).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ title: "Revised title" }));
  });

  it("does not overwrite later edits when replaying an unchanged creation after a lost response", async () => {
    remote.createMovie.mockRejectedValueOnce(new Error("response lost"));
    const hook = open();
    await submit(hook, { form });
    remote.createMovie.mockImplementation(async (body) => ({ ...body, title: "Edited elsewhere" }));
    expect((await submit(hook, { form })).error).toBeUndefined();
    expect(remote.updateMovie).not.toHaveBeenCalled();
  });

  // A blank year reaches buildMovieSavePayload as null, which the API refuses,
  // and the project page's inline editor has no form element to require it.
  it.each([
    { status: 400, verdict: "drops", replayed: 2024 },
    { status: 409, verdict: "drops", replayed: 2024 },
    { status: 503, verdict: "replays", replayed: null },
    { status: undefined, verdict: "replays", replayed: null },
  ])("$verdict a film creation the API answered with $status", async ({ status, replayed }) => {
    remote.createMovie.mockRejectedValueOnce(Object.assign(new Error("refused"), { status }));
    const hook = open();
    await submit(hook, { form: { ...form, year: "" } });
    expect((await submit(hook, { form })).error).toBeUndefined();
    expect(remote.createMovie.mock.calls.map(([body]) => body.year)).toEqual([null, replayed]);
    expect(localStorage.length).toBe(0);
  });

  it("drops a refused creation across a reload, so corrected details can finish the film save", async () => {
    remote.createMovie.mockRejectedValueOnce(Object.assign(new Error("Invalid body."), { status: 400 }));
    const first = open();
    await submit(first, { form: { ...form, year: "" } });
    expect(first.result.current.recovery.message).toBe("Film creation did not finish. Retry to finish this film save.");
    first.unmount();

    const recovered = open();
    expect((await submit(recovered, { form })).error).toBeUndefined();
    expect(remote.createMovie).toHaveBeenCalledTimes(2);
    expect(remote.createMovie.mock.calls[1][0]).toMatchObject({ year: 2024, id: remote.createMovie.mock.calls[0][0].id });
    expect(localStorage.length).toBe(0);
  });

  it.each(["cover", "script"])("retains a completed %s upload across reload when attachment fails", async (kind) => {
    const attachment = kind === "cover" ? remote.updateMovieCover : remote.saveScript;
    attachment.mockRejectedValueOnce(new Error("attachment response lost"));
    const first = open();
    await submit(first, { form, [kind === "cover" ? "coverFile" : "scriptFile"]: kind === "cover" ? cover() : file() });
    const movieId = remote.createMovie.mock.calls[0][0].id;
    first.unmount();
    // Opening the known film's edit route also finds a pending creation.
    const recovered = open({ movieId });
    expect(recovered.result.current.recovery.message).not.toContain("Choose");
    expect((await submit(recovered, {})).error).toBeUndefined();
    expect(remote.createMovie).toHaveBeenCalledTimes(1);
    expect(remote.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect(attachment.mock.calls[1]).toEqual(attachment.mock.calls[0]);
  });

  it("asks for an unfinished file after reload and reuses its upload identity when reselected", async () => {
    remote.uploadMediaFile.mockRejectedValueOnce(new Error("PUT response lost"));
    const first = open();
    await submit(first, { form, scriptFile: file() });
    const uploadId = remote.uploadMediaFile.mock.calls[0][0].uploadId;
    first.unmount();
    const recovered = open();
    expect(recovered.result.current.recovery.message).toContain("Choose “script.pdf” again");
    expect((await submit(recovered, {})).error.message).toContain("Choose “script.pdf” again");
    expect(remote.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect((await submit(recovered, { scriptFile: file() })).error).toBeUndefined();
    expect(remote.uploadMediaFile.mock.calls[1][0].uploadId).toBe(uploadId);
    expect(remote.createMovie).toHaveBeenCalledTimes(1);
  });

  it("refuses an unreadable script before any write, then accepts a readable one", async () => {
    pdfUnreadable();
    const hook = open();
    const refused = await submit(hook, { form, scriptFile: file() });
    expect(refused.error.message).toBe("That script PDF could not be read. Choose a different file.");
    expect(remote.createMovie).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);

    pdfPages(121);
    expect((await submit(hook, { form, scriptFile: file() })).error).toBeUndefined();
    expect(remote.saveScript).toHaveBeenCalledTimes(1);
  });

  it("refuses a PDF longer than a screenplay before any write", async () => {
    pdfPages(301);
    const hook = open();
    const refused = await submit(hook, { form, scriptFile: file() });
    expect(refused.error.message).toBe("A script can be at most 300 pages. That PDF has 301.");
    expect(remote.createMovie).not.toHaveBeenCalled();
    expect(remote.uploadMediaFile).not.toHaveBeenCalled();
  });

  it("finishes an attachment retry from a later session that no longer holds the file", async () => {
    pdfPages(121);
    remote.saveScript.mockRejectedValueOnce(new Error("attachment response lost"));
    const first = open();
    await submit(first, { form, scriptFile: file() });
    const movieId = remote.createMovie.mock.calls[0][0].id;
    first.unmount();

    const recovered = open({ movieId });
    pdf.getDocument.mockImplementation(() => { throw new Error("the file is gone"); });
    expect((await submit(recovered, {})).error).toBeUndefined();
    // The retry re-attaches the object already uploaded, without reading the PDF.
    expect(remote.saveScript.mock.calls[1][0].key).toBe(remote.saveScript.mock.calls[0][0].key);
  });

  it("allocates a new upload when replacement content has the same filename", async () => {
    remote.saveScript.mockRejectedValueOnce(new Error("attach failed"));
    const hook = open({ movieId: "existing-film" });
    await submit(hook, { scriptFile: file("original") });
    await submit(hook, { scriptFile: file("replacement") });
    const [original, replacement] = remote.uploadMediaFile.mock.calls.map(([args]) => args.uploadId);
    expect(original).not.toBe(replacement);
    expect(remote.saveScript.mock.calls[1][0].key).toContain(replacement);
    expect(remote.createMovie).not.toHaveBeenCalled();
  });

  it("refuses duplicate submits while a request is pending", async () => {
    let finish;
    remote.createMovie.mockImplementation((body) => new Promise((resolve) => { finish = () => resolve(body); }));
    const hook = open();
    let pending;
    act(() => { pending = hook.result.current.save({ form }); });
    expect(hook.result.current.saving).toBe(true);
    await act(async () => {
      await expect(hook.result.current.save({ form })).rejects.toThrow("already in progress");
      finish();
      await pending;
    });
    expect(remote.createMovie).toHaveBeenCalledTimes(1);
  });

  it("validates all chosen files before creating a film", async () => {
    const hook = open();
    const { error } = await submit(hook, { form, scriptFile: cover() });
    expect(error.message).toBe("Please choose a PDF file for the script.");
    expect(remote.createMovie).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("does not send requests if recovery cannot be persisted", async () => {
    const hook = open();
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { error } = await submit(hook, { form });
    expect(error.message).toContain("Allow site storage");
    expect(remote.createMovie).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("separates recovery by admin and refuses stale progress from another page", async () => {
    const first = open();
    const stale = open();
    remote.createMovie.mockRejectedValueOnce(new Error("offline"));
    await submit(first, { form });
    expect((await submit(stale, { form })).error.message).toContain("another page");
    expect(remote.createMovie).toHaveBeenCalledTimes(1);
    const otherAdmin = open({ ownerId: "admin-2" });
    expect(otherAdmin.result.current.recovery).toBeNull();
  });

  it("allows leaving an unfinished save without undoing completed work", async () => {
    remote.uploadMediaFile.mockRejectedValueOnce(new Error("offline"));
    const hook = open();
    await submit(hook, { form, scriptFile: file() });
    const firstId = remote.createMovie.mock.calls[0][0].id;
    act(() => hook.result.current.leave());
    expect(localStorage.length).toBe(0);
    expect(hook.result.current.recovery).toBeNull();
    await submit(hook, { form: { ...form, title: "Another film" } });
    expect(remote.createMovie.mock.calls[1][0].id).not.toBe(firstId);
    expect(remote.updateMovie).not.toHaveBeenCalled();
  });

  it.each(["finish", "leave"])("uses the existing film's own recovery slot after adopting a creation and choosing to %s", async (action) => {
    remote.uploadMediaFile.mockRejectedValueOnce(new Error("offline"));
    const creation = open();
    await submit(creation, { form, scriptFile: file() });
    const movieId = remote.createMovie.mock.calls[0][0].id;
    creation.unmount();
    const detail = open({ movieId });
    if (action === "finish") {
      expect((await submit(detail, { scriptFile: file() })).error).toBeUndefined();
    } else {
      act(() => detail.result.current.leave());
    }
    remote.updateMovie.mockRejectedValueOnce(new Error("later edit failed"));
    await submit(detail, { form: { ...form, title: "Later edit" } });
    const newFilm = open();
    expect(newFilm.result.current.recovery).toBeNull();
    const existingFilm = open({ movieId });
    expect(existingFilm.result.current.recovery.form.title).toBe("Later edit");
  });
});

describe("film-save recovery left behind by an earlier format", () => {
  it.each([1, 2])("finishes a v%i film creation whose response was lost, under the identity it was sent with", async (version) => {
    const original = buildMovieSavePayload(form);
    localStorage.setItem(legacyKey(version), legacyJob(version, {
      form: { ...form, title: "Revised title" }, creationPayload: original,
    }));

    const hook = open();
    // The legacy record is gone only because the converted one took its place.
    expect(localStorage.getItem(currentKey())).not.toBeNull();
    expect(localStorage.getItem(legacyKey(version))).toBeNull();
    expect(hook.result.current.recovery.movieId).toBe("film-uuid-1");
    expect(hook.result.current.recovery.form.title).toBe("Revised title");

    expect((await submit(hook, {})).error).toBeUndefined();
    expect(remote.createMovie).toHaveBeenCalledTimes(1);
    expect(remote.createMovie.mock.calls[0][0]).toEqual({ ...original, id: "film-uuid-1" });
    expect(remote.updateMovie).toHaveBeenCalledWith("film-uuid-1", expect.objectContaining({ title: "Revised title" }));
    expect(localStorage.length).toBe(0);
  });

  it.each([1, 2])("attaches a v%i upload that finished but was never attached, without uploading again", async (version) => {
    localStorage.setItem(legacyKey(version, "film-uuid-1"), legacyJob(version, {
      created: true, form: null, savedPayload: buildMovieSavePayload(form),
      script: {
        name: "script.pdf", fingerprint: "application/pdf:ab12", uploadId: "upload-7",
        key: "script/film-uuid-1/upload-7", attached: false,
      },
    }));

    const hook = open({ movieId: "film-uuid-1" });
    expect(hook.result.current.recovery.message).toContain("Film details saved.");
    expect(hook.result.current.recovery.message).not.toContain("Choose");

    expect((await submit(hook, {})).error).toBeUndefined();
    expect(remote.uploadMediaFile).not.toHaveBeenCalled();
    expect(remote.saveScript).toHaveBeenCalledWith({ movieId: "film-uuid-1", key: "script/film-uuid-1/upload-7" });
    expect(remote.createMovie).not.toHaveBeenCalled();
    expect(remote.updateMovie).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("finishes an upload a legacy record began, under the upload identity it began under", async () => {
    localStorage.setItem(legacyKey(2, "film-uuid-1"), legacyJob(2, {
      created: true, form: null,
      script: {
        name: "script.pdf", fingerprint: await contentIdentity(file()), uploadId: "upload-7",
        key: null, attached: false,
      },
    }));

    const hook = open({ movieId: "film-uuid-1" });
    expect(hook.result.current.recovery.message).toContain("Choose “script.pdf” again");

    expect((await submit(hook, { scriptFile: file() })).error).toBeUndefined();
    expect(remote.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect(remote.uploadMediaFile.mock.calls[0][0].uploadId).toBe("upload-7");
    expect(remote.saveScript.mock.calls[0][0].key).toContain("upload-7");
  });

  it("refuses a legacy record of a shape no release wrote, and leaves it where it is", async () => {
    const foreign = JSON.stringify({ version: 1, movieId: "film-uuid-1", created: false, form, script: { name: "script.pdf" } });
    localStorage.setItem(legacyKey(1), foreign);

    const hook = open();
    expect(hook.result.current.recovery.message).toContain("Restore this browser's site storage");
    expect((await submit(hook, { form })).error.message).toContain("Restore this browser's site storage");
    expect(remote.createMovie).not.toHaveBeenCalled();
    expect(localStorage.getItem(legacyKey(1))).toBe(foreign);
    expect(localStorage.length).toBe(1);
  });

  it("keeps a legacy record that cannot be converted, and converts it once storage allows", async () => {
    const original = buildMovieSavePayload(form);
    const pending = legacyJob(1, { creationPayload: original });
    localStorage.setItem(legacyKey(1), pending);

    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const blocked = open();
    write.mockRestore();
    expect(localStorage.getItem(legacyKey(1))).toBe(pending);
    expect(localStorage.getItem(currentKey())).toBeNull();
    // The pending creation is refused rather than replaced by a second film.
    expect((await submit(blocked, { form })).error.message).toContain("Restore this browser's site storage");
    expect(remote.createMovie).not.toHaveBeenCalled();
    blocked.unmount();

    const recovered = open();
    expect((await submit(recovered, {})).error).toBeUndefined();
    expect(remote.createMovie.mock.calls[0][0]).toEqual({ ...original, id: "film-uuid-1" });
  });

  it("leaves a legacy record alone while this release's own record holds the key", async () => {
    remote.createMovie.mockRejectedValueOnce(new Error("offline"));
    const current = open();
    await submit(current, { form });
    const interrupted = localStorage.getItem(currentKey());
    const pending = legacyJob(2, { creationPayload: buildMovieSavePayload(form) });
    localStorage.setItem(legacyKey(2), pending);
    current.unmount();

    const reopened = open();
    expect(localStorage.getItem(currentKey())).toBe(interrupted);
    expect(localStorage.getItem(legacyKey(2))).toBe(pending);
    expect(reopened.result.current.recovery.movieId).not.toBe("film-uuid-1");
    expect((await submit(reopened, {})).error).toBeUndefined();
    reopened.unmount();

    // Once that film save lets the key go, the legacy record is converted.
    const later = open();
    expect(localStorage.getItem(legacyKey(2))).toBeNull();
    expect(later.result.current.recovery.movieId).toBe("film-uuid-1");
  });
});
