import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/lib/errors.js";
import FilmDetailPage from "./FilmDetailPage.jsx";

/*
 * Still editing on the film page: adding a still, editing its timestamp or
 * image in the scene viewer, and deleting it. Only external edges are doubled
 * (the API modules and the session); the page, the scene viewer and the form
 * controls are real, so error placement is checked where people see it.
 * Still-save orchestration is real; upload and record requests are mocked.
 */

const api = vi.hoisted(() => ({
  getFilm: vi.fn(),
  updateFilm: vi.fn(),
  getFilmScript: vi.fn(),
  saveScript: vi.fn(),
  listStills: vi.fn(),
  createStill: vi.fn(),
  updateStill: vi.fn(),
  deleteStill: vi.fn(),
  listScriptScenes: vi.fn(),
  getViewUrlForKey: vi.fn(),
  uploadMediaFile: vi.fn(),
}));
const session = vi.hoisted(() => ({ isAdmin: true, user: { id: "admin-1" } }));

vi.mock("@/shared/api/stills.js", () => ({
  listStills: api.listStills,
  createStill: api.createStill,
  updateStill: api.updateStill,
  deleteStill: api.deleteStill,
}));
vi.mock("@/shared/api/films.js", () => ({ getFilm: api.getFilm, updateFilm: api.updateFilm }));
vi.mock("@/shared/api/scripts.js", () => ({ getFilmScript: api.getFilmScript, saveScript: api.saveScript }));
vi.mock("@/shared/api/scriptScenes.js", () => ({ listScriptScenes: api.listScriptScenes }));
vi.mock("@/shared/api/uploads.js", () => ({ getViewUrlForKey: api.getViewUrlForKey, uploadMediaFile: api.uploadMediaFile }));
// The film save reads a script's page count straight from pdf.js.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 121 }), destroy: async () => {} }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-stub" }));
vi.mock("@/entities/session/model/useSession.js", () => ({ useSession: () => session }));

// jsdom has no object URLs; the add dialog previews the picked image with one.
URL.createObjectURL ??= () => "blob:still-preview";
URL.revokeObjectURL ??= () => {};

const FILM = { id: "m1", title: "Night Diner", runtime_minutes: 120 };
const SCRIPT = { id: "s1", movie_id: "m1", s3_key: "scripts/m1.pdf", script_url: "https://media.test/m1.pdf" };
const SHOT_LIMIT_LABEL = "02:01:00";
const WITH_IMAGE = {
  id: "a1",
  movie_id: "m1",
  time_seconds: 300,
  image_key: "stills/a1.jpg",
  image_url: "https://media.test/a1.jpg",
};
// Timed to a tenth, as a second shot caught in the same second would be.
const WITHOUT_IMAGE = { id: "a2", movie_id: "m1", time_seconds: 900.5, image_key: null, image_url: null };

const BAD_TIME =
  "Use HH:MM:SS (or MM:SS) for the timestamp, with a tenth of a second like 00:10:00.5 if you need one.";
const PAST_RUNTIME = `The timestamp can't be later than ${SHOT_LIMIT_LABEL} (runtime plus one minute).`;
const BAD_RUNTIME = "Runtime must use HH:MM:SS and be at least 00:01:00.";

let stills;

/** A promise the test settles itself. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Settles a held request, then lets everything awaiting it run. */
async function settle(settleRequest) {
  await act(async () => {
    settleRequest();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function imageFile(name = "frame.png") {
  return new File(["frame"], name, { type: "image/png" });
}

function s3Failure() {
  return new ApiError("S3 upload failed: 403 Forbidden", { status: 403, body: { raw: "AccessDenied" } });
}

async function renderPage({ admin = true } = {}) {
  session.isAdmin = admin;
  render(
    <MemoryRouter initialEntries={["/films/m1"]}>
      <Routes>
        <Route path="/films/:id" element={<FilmDetailPage />} />
        <Route path="/films/:filmId/scripts/:scriptId" element={<p>Opened script</p>} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { name: "Night Diner", level: 1 });
  await waitFor(() => expect(screen.getByRole("region", { name: "Film stills" }).getAttribute("aria-busy")).toBe("false"));
}

/** Opens the hero's cover: the details become inputs and its title page holds the script. */
function openCover() {
  fireEvent.click(screen.getByRole("button", { name: "Edit details and script" }));
}

/** The script's controls, on the title page the open cover shows. */
function scriptPage() {
  return screen.getByRole("group", { name: "Script" });
}

function pdfFile(name = "script.pdf") {
  return new File(["%PDF"], name, { type: "application/pdf" });
}

function viewer() {
  return screen.getByRole("dialog", { name: "Night Diner" });
}

function addDialog() {
  return screen.getByRole("dialog", { name: "Add a film still" });
}

function queryAddDialog() {
  return screen.queryByRole("dialog", { name: "Add a film still" });
}

function openStill(time) {
  fireEvent.click(screen.getByRole("button", { name: `Open still at ${time}` }));
  return viewer();
}

function viewerButton(name) {
  return within(viewer()).getByRole("button", { name });
}

function chooseFile(container, file) {
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
}

function typeTime(container, value) {
  const input = within(container).getByPlaceholderText("HH:MM:SS");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
}

/** The viewer's still stage: the still's tools and the image (or its "no image" note). */
function stillStage() {
  const image = within(viewer()).queryByRole("img", { name: /^Film still at/ });
  return (image ?? within(viewer()).getByText("This still has no image.")).parentElement;
}

/** Asserts the viewer shows `message` as an error above the still. */
function expectErrorAboveStill(message) {
  const stage = stillStage();
  const alert = within(viewer()).getByRole("alert");
  expect(alert.textContent).toBe(message);
  expect(alert.parentElement).toBe(stage);
  expect(stage.lastElementChild.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
}

function editForm() {
  return within(viewer()).queryByRole("textbox", { name: "Timestamp" })?.closest("div") ?? null;
}

/**
 * Opens the still at 00:05:00, then saves its edit or deletes it (`kind` is
 * "save" or "delete"). The request waits until the test settles the returned
 * deferred; a delete that succeeds removes the still.
 */
function startHeldRequest(kind) {
  const request = deferred();
  openStill("00:05:00");
  if (kind === "save") {
    api.updateStill.mockReturnValueOnce(request.promise);
    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));
  } else {
    window.confirm.mockReturnValue(true);
    api.deleteStill.mockImplementationOnce(async (filmId, stillId) => {
      await request.promise;
      stills = stills.filter((row) => row.id !== stillId);
    });
    fireEvent.click(viewerButton("Delete"));
  }
  return request;
}

/** Types a time after the hero's stills count, with its cover open, and presses Enter. */
async function openAddDialog(time = "00:01:00") {
  if (!screen.queryByRole("textbox", { name: "Add a still at" })) openCover();
  const field = screen.getByRole("textbox", { name: "Add a still at" });
  fireEvent.change(field, { target: { value: time } });
  fireEvent.keyDown(field, { key: "Enter" });
  return addDialog();
}

function submitAdd() {
  fireEvent.click(within(addDialog()).getByRole("button", { name: /^(Add still|Adding…)$/ }));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  stills = [WITH_IMAGE, WITHOUT_IMAGE];
  for (const fn of Object.values(api)) fn.mockReset();
  api.getFilm.mockImplementation(async () => ({ ...FILM }));
  api.getFilmScript.mockImplementation(async () => null);
  api.listStills.mockImplementation(async () => stills.map((row) => ({ ...row })));
  api.listScriptScenes.mockImplementation(async () => []);
  api.getViewUrlForKey.mockImplementation(async () => ({ url: "" }));
  api.uploadMediaFile.mockResolvedValue("annotations/m1/upload.png");
  api.createStill.mockImplementation(async ({ id, timeSeconds, imageKey }) => ({ id, movie_id: "m1", time_seconds: timeSeconds, image_key: imageKey }));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loading the film's script", () => {
  it("does not replay a canceled script replacement when later saving film details", async () => {
    api.uploadMediaFile.mockResolvedValue("scripts/m1/canceled.pdf");
    api.saveScript.mockRejectedValueOnce(new Error("attachment failed"));
    await renderPage();
    openCover();
    chooseFile(scriptPage(), pdfFile("replacement.pdf"));
    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Upload PDF" }));
    await screen.findByText("Failed to save script PDF.");
    window.confirm.mockReturnValue(true);
    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Resume film save" })).toBeNull());
    fireEvent.change(screen.getByRole("textbox", { name: /^Title/ }), { target: { value: "Updated title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateFilm).toHaveBeenCalledTimes(1));
    expect(api.saveScript).toHaveBeenCalledTimes(1);
    expect(api.uploadMediaFile).toHaveBeenCalledTimes(1);
  });

  it("does not replay canceled film details when later uploading a script", async () => {
    api.updateFilm.mockRejectedValueOnce(new Error("details failed"));
    await renderPage();
    openCover();
    fireEvent.change(screen.getByRole("textbox", { name: /^Title/ }), { target: { value: "Canceled title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Failed to save film details.");
    window.confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    api.uploadMediaFile.mockResolvedValue("scripts/m1/replacement.pdf");
    api.saveScript.mockResolvedValue(SCRIPT);
    openCover();
    chooseFile(scriptPage(), pdfFile("replacement.pdf"));
    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Upload PDF" }));
    expect(await screen.findByRole("button", { name: "Open script" })).toBeTruthy();
    expect(api.updateFilm).toHaveBeenCalledTimes(1);
    expect(api.saveScript).toHaveBeenCalledTimes(1);
  });

  it("retries a standalone script attachment without uploading it again", async () => {
    api.uploadMediaFile.mockResolvedValue("scripts/m1/upload.pdf");
    api.saveScript.mockRejectedValueOnce(new Error("attachment failed")).mockResolvedValueOnce(SCRIPT);
    await renderPage();
    openCover();
    chooseFile(scriptPage(), pdfFile());
    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Upload PDF" }));
    expect(await screen.findByText("Failed to save script PDF.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resume film save" }).getAttribute("href")).toBe("/films/m1/edit");
    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Upload PDF" }));
    expect(await screen.findByRole("button", { name: "Open script" })).toBeTruthy();
    expect(api.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect(api.saveScript).toHaveBeenCalledTimes(2);
    expect(api.saveScript).toHaveBeenLastCalledWith({ filmId: "m1", key: "scripts/m1/upload.pdf" });
  });

  it("asks on the title page before a new PDF replaces the script, and sends nothing until asked", async () => {
    api.getFilmScript.mockImplementation(async () => ({ ...SCRIPT }));
    api.uploadMediaFile.mockResolvedValue("scripts/m1/revised.pdf");
    api.saveScript.mockResolvedValue({ ...SCRIPT, id: "s2" });
    await renderPage();
    openCover();
    chooseFile(scriptPage(), pdfFile("revised.pdf"));

    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Upload PDF" }));
    expect(within(scriptPage()).getByRole("alert").textContent).toMatch(/^Replace this script\?/);
    expect(api.uploadMediaFile).not.toHaveBeenCalled();

    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(api.saveScript).toHaveBeenCalledTimes(1));
    expect(await within(scriptPage()).findByRole("button", { name: "Replace PDF" })).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("consumes the one script object and opens it from the open cover's title page", async () => {
    api.getFilmScript.mockResolvedValueOnce({ ...SCRIPT });

    await renderPage();
    openCover();

    expect(api.getFilmScript).toHaveBeenCalledWith("m1");
    expect(within(scriptPage()).getByText("Script uploaded")).toBeTruthy();
    fireEvent.click(within(scriptPage()).getByRole("button", { name: "Open script" }));
    expect(await screen.findByText("Opened script")).toBeTruthy();
  });

  it("consumes null without keeping a script selection", async () => {
    await renderPage();
    openCover();

    expect(api.getFilmScript).toHaveBeenCalledWith("m1");
    expect(within(scriptPage()).getByText("No script yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open script" })).toBeNull();
  });
});

describe("editing film details in the hero", () => {
  function detail(name) {
    return screen.getByRole("textbox", { name });
  }

  /** The film as the API holds it; saving details changes what the next load returns. */
  function storeFilmEdits() {
    let stored = { ...FILM };
    api.getFilm.mockImplementation(async () => ({ ...stored }));
    api.updateFilm.mockImplementation(async (filmId, details) => {
      stored = { ...stored, ...details };
      return { ...stored };
    });
  }

  it("opens from the cover with every detail as an input and the caret at the end of the last one shown", async () => {
    await renderPage();

    openCover();

    expect(detail("Title").value).toBe("Night Diner");
    expect(detail("Runtime").value).toBe("02:00:00");
    for (const name of ["Year", "Director", "Cinematographer", "Writer"]) expect(detail(name).value).toBe("");
    expect(document.activeElement).toBe(detail("Runtime"));
    expect(detail("Runtime").selectionStart).toBe("02:00:00".length);
    expect(screen.getByRole("button", { name: "Save details" })).toBeTruthy();
  });

  it("saves the typed details with Enter, shows them, and leaves focus on the title", async () => {
    storeFilmEdits();
    await renderPage();
    openCover();

    fireEvent.change(detail("Title"), { target: { value: "Night Diner Redux" } });
    fireEvent.change(detail("Year"), { target: { value: "1999" } });
    fireEvent.change(detail("Director"), { target: { value: "Ada Lane" } });
    fireEvent.keyDown(detail("Director"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(api.updateFilm).toHaveBeenCalledWith("m1", {
      title: "Night Diner Redux",
      director: "Ada Lane",
      writer: null,
      cinematographer: null,
      year: 1999,
      runtime_minutes: 120,
    });
    expect(screen.getByRole("heading", { name: "Night Diner Redux", level: 1 })).toBeTruthy();
    expect(screen.getByText("Ada Lane")).toBeTruthy();
    expect(screen.getByText("1999")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("saves when the open cover or Save is clicked", async () => {
    storeFilmEdits();
    await renderPage();

    openCover();
    fireEvent.change(detail("Title"), { target: { value: "First cut" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByRole("heading", { name: "First cut", level: 1 })).toBeTruthy();

    openCover();
    fireEvent.change(detail("Title"), { target: { value: "Final cut" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Final cut", level: 1 })).toBeTruthy();
    expect(api.updateFilm).toHaveBeenCalledTimes(2);
  });

  it("discards with Esc or Discard, sends nothing, and opens next time on the saved details", async () => {
    await renderPage();

    openCover();
    fireEvent.change(detail("Title"), { target: { value: "Thrown away" } });
    fireEvent.keyDown(detail("Title"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Night Diner", level: 1 })).toBeTruthy();

    openCover();
    expect(detail("Title").value).toBe("Night Diner");
    fireEvent.change(detail("Writer"), { target: { value: "Thrown away" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Thrown away")).toBeNull();
    expect(api.updateFilm).not.toHaveBeenCalled();
  });

  it("keeps a title on one line, even pasted", async () => {
    await renderPage();
    openCover();

    fireEvent.change(detail("Title"), { target: { value: "Night\nDiner\r\nTwo" } });

    expect(detail("Title").value).toBe("Night Diner Two");
  });

  it("tidies a typed runtime when its field loses focus", async () => {
    await renderPage();
    openCover();

    fireEvent.change(detail("Runtime"), { target: { value: "20500" } });
    fireEvent.blur(detail("Runtime"));

    expect(detail("Runtime").value).toBe("02:05:00");
  });

  it("shows the shared runtime validation message without sending a request", async () => {
    await renderPage();
    openCover();
    fireEvent.change(detail("Runtime"), { target: { value: "00:60:00" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(BAD_RUNTIME)).toBeTruthy();
    expect(api.updateFilm).not.toHaveBeenCalled();
    expect(detail("Runtime").value).toBe("00:60:00");
  });

  it("shows its entry-point failure message and keeps the editor open", async () => {
    api.updateFilm.mockRejectedValueOnce(new Error("save failed"));
    await renderPage();
    openCover();
    fireEvent.change(detail("Title"), { target: { value: "Kept" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save film details.")).toBeTruthy();
    expect(detail("Title").value).toBe("Kept");
  });

  it("holds the details while they save, so a second Enter sends nothing more", async () => {
    const request = deferred();
    api.updateFilm.mockReturnValueOnce(request.promise);
    await renderPage();
    openCover();

    fireEvent.keyDown(detail("Runtime"), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" }).disabled).toBe(true));
    expect(detail("Runtime").readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Discard" }).disabled).toBe(true);
    fireEvent.keyDown(detail("Runtime"), { key: "Enter" });
    fireEvent.keyDown(detail("Runtime"), { key: "Escape" });

    await settle(() => request.resolve({ ...FILM }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(api.updateFilm).toHaveBeenCalledTimes(1);
  });
});

describe("adding a still", () => {
  it.each(["02:00:25", "02:01:00"])("accepts %s within the one-minute runtime allowance", async (time) => {
    await renderPage();
    const dialog = await openAddDialog();
    chooseFile(dialog, imageFile());
    typeTime(dialog, time);
    submitAdd();
    await waitFor(() => expect(api.createStill).toHaveBeenCalledWith(expect.objectContaining({
      timeSeconds: time === "02:00:25" ? 7225 : 7260,
    })));
    await waitFor(() => expect(queryAddDialog()).toBeNull());
  });

  it("rejects a malformed timestamp and one past the runtime, in the dialog", async () => {
    await renderPage();
    const dialog = await openAddDialog();
    chooseFile(dialog, imageFile());

    typeTime(dialog, "00:00:75");
    submitAdd();
    expect(within(addDialog()).getByRole("alert").textContent).toBe(BAD_TIME);

    typeTime(dialog, "02:01:01");
    submitAdd();
    expect(within(addDialog()).getByRole("alert").textContent).toBe(PAST_RUNTIME);

    expect(api.createStill).not.toHaveBeenCalled();
  });

  it("requires an image", async () => {
    await renderPage();
    const dialog = await openAddDialog();

    typeTime(dialog, "10:00");
    submitAdd();

    expect(within(addDialog()).getByRole("alert").textContent).toBe("Choose a still image to add.");
    expect(api.createStill).not.toHaveBeenCalled();
  });

  it("refuses a dropped file that isn't an image", async () => {
    await renderPage();
    const dialog = await openAddDialog();

    const zone = within(dialog).getByRole("button", { name: /Drop a still here/ }).parentElement;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["%PDF"], "script.pdf", { type: "application/pdf" })] } });

    expect(within(addDialog()).getByRole("alert").textContent).toBe("That file isn't an image. Choose a JPG or PNG.");
  });

  it("normalizes the typed timestamp when the field loses focus", async () => {
    await renderPage();
    const dialog = await openAddDialog();

    expect(typeTime(dialog, "10:00").value).toBe("00:10:00");
    expect(typeTime(dialog, "10:00.5").value).toBe("00:10:00.5");
    expect(typeTime(dialog, "10:75").value).toBe("00:10:75");
    expect(
      within(dialog).getByText(
        `Between 00:00:00 and ${SHOT_LIMIT_LABEL} (includes one-minute allowance). Add a tenth, like 00:10:00.5, for a second shot in the same second.`
      )
    ).toBeTruthy();
  });

  it("disables submit while adding, then shows a record failure in the dialog and keeps it open", async () => {
    await renderPage();
    const request = deferred();
    api.createStill.mockReturnValue(request.promise);
    const dialog = await openAddDialog();
    const file = imageFile();
    chooseFile(dialog, file);
    typeTime(dialog, "10:00");

    submitAdd();

    const busy = within(addDialog()).getByRole("button", { name: "Adding…" });
    expect(busy.disabled).toBe(true);
    await waitFor(() => expect(api.createStill).toHaveBeenCalledTimes(1));
    expect(api.createStill).toHaveBeenCalledWith({ filmId: "m1", id: expect.any(String), timeSeconds: 600, imageKey: "annotations/m1/upload.png" });

    await act(async () => request.reject(s3Failure()));

    expect(queryAddDialog()).not.toBeNull();
    expect(within(addDialog()).getByRole("alert").textContent).toBe("Failed to add the still.");
    expect(within(addDialog()).getByRole("button", { name: "Add still" }).disabled).toBe(false);
    expect(api.listStills).toHaveBeenCalledTimes(1);
  });

  it("closes the dialog and refreshes the stills once the still is saved", async () => {
    await renderPage();
    const added = { id: "a3", movie_id: "m1", time_seconds: 600, image_key: "stills/a3.png", image_url: "https://media.test/a3.png" };
    api.createStill.mockImplementation(async ({ id }) => {
      added.id = id;
      stills = [...stills, added];
      return added;
    });
    const dialog = await openAddDialog();
    chooseFile(dialog, imageFile());
    typeTime(dialog, "00:10:00");

    submitAdd();

    expect(await screen.findByRole("button", { name: "Open still at 00:10:00" })).toBeTruthy();
    expect(queryAddDialog()).toBeNull();
    expect(api.listStills).toHaveBeenCalledTimes(2);
  });

  it("retries a failed creation with the uploaded image and applies changed timing to the same still", async () => {
    await renderPage();
    api.createStill.mockRejectedValueOnce(new Error("response lost"));
    const dialog = await openAddDialog();
    chooseFile(dialog, imageFile());
    typeTime(dialog, "10:00");
    submitAdd();
    await waitFor(() => expect(within(addDialog()).getByRole("alert").textContent).toBe("Failed to add the still."));
    const original = api.createStill.mock.calls[0][0];

    typeTime(dialog, "11:00");
    submitAdd();
    await waitFor(() => expect(queryAddDialog()).toBeNull());
    expect(api.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect(api.createStill.mock.calls[1][0]).toEqual(original);
    expect(api.updateStill).toHaveBeenCalledWith({ filmId: "m1", stillId: original.id, timeSeconds: 660, imageKey: original.imageKey });
  });

  it.each(["success", "failure"])("keeps an earlier add's %s out of a reopened dialog", async (outcome) => {
    await renderPage();
    const earlier = deferred();
    const later = deferred();
    api.createStill.mockImplementationOnce(async ({ id }) => {
      await earlier.promise;
      return { id };
    }).mockImplementationOnce(async ({ id }) => {
      await later.promise;
      return { id };
    });
    let dialog = await openAddDialog();
    chooseFile(dialog, imageFile());
    typeTime(dialog, "10:00");
    submitAdd();
    await waitFor(() => expect(api.createStill).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    dialog = await openAddDialog();
    chooseFile(dialog, imageFile());
    typeTime(dialog, "11:00");
    submitAdd();
    await waitFor(() => expect(api.createStill).toHaveBeenCalledTimes(2));
    expect(api.createStill.mock.calls[0][0].id).not.toBe(api.createStill.mock.calls[1][0].id);
    await settle(() => outcome === "success" ? earlier.resolve() : earlier.reject(new Error("offline")));
    expect(within(addDialog()).getByRole("button", { name: "Adding…" }).disabled).toBe(true);
    expect(within(addDialog()).queryByRole("alert")).toBeNull();
    expect(within(addDialog()).getByPlaceholderText("HH:MM:SS").value).toBe("00:11:00");
    await settle(() => later.resolve());
    expect(queryAddDialog()).toBeNull();
  });

  it("opens on the time typed in the hero, with a fresh form each time", async () => {
    await renderPage();
    let dialog = await openAddDialog("20:00");
    expect(within(dialog).getByPlaceholderText("HH:MM:SS").value).toBe("00:20:00");
    typeTime(dialog, "00:00:75");
    submitAdd();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(queryAddDialog()).toBeNull();

    dialog = await openAddDialog("00:21:00.5");
    expect(within(dialog).getByPlaceholderText("HH:MM:SS").value).toBe("00:21:00.5");
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("marks the typed time on the timeline until the cover closes", async () => {
    await renderPage();
    openCover();
    const field = screen.getByRole("textbox", { name: "Add a still at" });

    fireEvent.change(field, { target: { value: "00:30:00" } });
    expect(screen.getByText("+ 00:30:00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("+ 00:30:00")).toBeNull();
  });
});

describe("editing a still in the viewer", () => {
  it("shows a save failure above the still and keeps the edit open", async () => {
    await renderPage();
    api.updateStill.mockRejectedValue(s3Failure());
    openStill("00:05:00");

    fireEvent.click(viewerButton("Edit"));
    typeTime(editForm(), "6:00");
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expectErrorAboveStill("Failed to save the still."));
    expect(editForm()).not.toBeNull();
    expect(api.listStills).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed timestamp and one past the runtime, above the still", async () => {
    await renderPage();
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));

    typeTime(editForm(), "5:77");
    fireEvent.click(viewerButton("Save"));
    await waitFor(() => expectErrorAboveStill(BAD_TIME));

    typeTime(editForm(), "03:00:00");
    fireEvent.click(viewerButton("Save"));
    await waitFor(() => expectErrorAboveStill(PAST_RUNTIME));

    expect(api.updateStill).not.toHaveBeenCalled();
  });

  it("requires an image when the still has none", async () => {
    await renderPage();
    api.updateStill.mockResolvedValue({ ...WITHOUT_IMAGE });
    openStill("00:15:00.5");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Save"));
    await waitFor(() => expectErrorAboveStill("Choose an image for this still."));
    expect(api.updateStill).not.toHaveBeenCalled();

    const file = imageFile("replacement.png");
    chooseFile(editForm(), file);
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expect(editForm()).toBeNull());
    expect(api.updateStill).toHaveBeenCalledWith({
      filmId: "m1",
      stillId: "a2",
      timeSeconds: 900.5,
      imageKey: "annotations/m1/upload.png",
    });
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it("saves the timestamp with the current image, refreshes the stills and clears the edit", async () => {
    await renderPage();
    api.updateStill.mockImplementation(async ({ timeSeconds }) => {
      stills = stills.map((row) => (row.id === "a1" ? { ...row, time_seconds: timeSeconds } : row));
      return stills[0];
    });
    openStill("00:05:00");

    fireEvent.click(viewerButton("Edit"));
    expect(within(viewer()).getByRole("textbox", { name: "Timestamp" }).value).toBe("00:05:00");
    expect(typeTime(editForm(), "6:00").value).toBe("00:06:00");
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expect(editForm()).toBeNull());
    expect(api.updateStill).toHaveBeenCalledWith({
      filmId: "m1",
      stillId: "a1",
      timeSeconds: 360,
      imageKey: "stills/a1.jpg",
    });
    expect(api.listStills).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Open still at 00:06:00" })).toBeTruthy();
    expect(viewerButton("Edit")).toBeTruthy();
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it("shows a failed reload after saving above the still", async () => {
    await renderPage();
    api.updateStill.mockResolvedValue({ ...WITH_IMAGE });
    api.listStills.mockRejectedValueOnce(new Error("connection reset"));
    openStill("00:05:00");

    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expectErrorAboveStill("Failed to load film."));
    expect(editForm()).toBeNull();
  });

  it("disables Save and Delete while saving, so a double click sends one request", async () => {
    await renderPage();
    const request = deferred();
    api.updateStill.mockReturnValue(request.promise);
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Save"));
    fireEvent.click(viewerButton("Save"));

    expect(api.updateStill).toHaveBeenCalledTimes(1);
    expect(viewerButton("Save").disabled).toBe(true);
    expect(viewerButton("Delete").disabled).toBe(true);

    await settle(() => request.reject(s3Failure()));

    expectErrorAboveStill("Failed to save the still.");
    expect(viewerButton("Save").disabled).toBe(false);
    expect(viewerButton("Delete").disabled).toBe(false);
  });

  it("toggles the edit with Cancel edit", async () => {
    await renderPage();
    openStill("00:05:00");

    fireEvent.click(viewerButton("Edit"));
    expect(editForm()).not.toBeNull();
    fireEvent.click(viewerButton("Cancel edit"));

    expect(editForm()).toBeNull();
    expect(viewerButton("Edit")).toBeTruthy();
  });
});

describe("deleting a still", () => {
  it("sends nothing when the confirm is canceled", async () => {
    await renderPage();
    openStill("00:05:00");

    fireEvent.click(viewerButton("Delete"));

    expect(window.confirm).toHaveBeenCalledWith("Delete this still?");
    expect(api.deleteStill).not.toHaveBeenCalled();
    expect(viewer()).toBeTruthy();
  });

  it("shows a delete failure above the still", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    api.deleteStill.mockRejectedValue(s3Failure());
    openStill("00:05:00");

    fireEvent.click(viewerButton("Delete"));

    await waitFor(() => expectErrorAboveStill("Failed to delete the still."));
    expect(api.listStills).toHaveBeenCalledTimes(1);
  });

  it("deletes the still, clears its edit and refreshes the stills", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    api.deleteStill.mockImplementation(async (filmId, stillId) => {
      stills = stills.filter((row) => row.id !== stillId);
    });
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Delete"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Open still at 00:05:00" })).toBeNull());
    expect(api.deleteStill).toHaveBeenCalledWith("m1", "a1");
    expect(api.listStills).toHaveBeenCalledTimes(2);
    expect(editForm()).toBeNull();
  });

  it("disables Delete and Save while deleting, so a double click sends one request", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    const request = deferred();
    api.deleteStill.mockReturnValue(request.promise);
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Delete"));
    fireEvent.click(viewerButton("Delete"));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(api.deleteStill).toHaveBeenCalledTimes(1);
    expect(viewerButton("Delete").disabled).toBe(true);
    expect(viewerButton("Save").disabled).toBe(true);

    await settle(() => request.reject(s3Failure()));

    expectErrorAboveStill("Failed to delete the still.");
    expect(viewerButton("Delete").disabled).toBe(false);
    expect(viewerButton("Save").disabled).toBe(false);
  });

  it("clears a still error once a delete succeeds", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    api.deleteStill.mockRejectedValueOnce(s3Failure()).mockImplementationOnce(async (filmId, stillId) => {
      stills = stills.filter((row) => row.id !== stillId);
    });
    openStill("00:05:00");
    fireEvent.click(viewerButton("Delete"));
    await waitFor(() => expectErrorAboveStill("Failed to delete the still."));

    fireEvent.click(viewerButton("Delete"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Open still at 00:05:00" })).toBeNull());
    expect(api.deleteStill).toHaveBeenCalledTimes(2);
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });
});

describe("closing the viewer", () => {
  it("drops the still edit and its error", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    api.deleteStill.mockRejectedValue(s3Failure());
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Delete"));
    await waitFor(() => expectErrorAboveStill("Failed to delete the still."));

    fireEvent.click(viewerButton("Close"));

    expect(screen.queryByRole("dialog", { name: "Night Diner" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    openStill("00:05:00");
    expect(within(viewer()).queryByRole("alert")).toBeNull();
    expect(editForm()).toBeNull();
    expect(viewerButton("Edit")).toBeTruthy();
  });

  it.each(["save", "delete"])("keeps a %s that fails afterwards from showing an error in the next viewer", async (kind) => {
    await renderPage();
    const request = startHeldRequest(kind);
    fireEvent.click(viewerButton("Close"));

    await settle(() => request.reject(s3Failure()));

    expect(screen.queryByRole("alert")).toBeNull();
    openStill("00:05:00");
    expect(within(viewer()).queryByRole("alert")).toBeNull();
    expect(editForm()).toBeNull();
    expect(api.listStills).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["save", "00:05:00"],
    ["delete", "00:15:00.5"],
  ])("still refreshes the stills when a %s succeeds afterwards", async (kind, reopenAt) => {
    await renderPage();
    const request = startHeldRequest(kind);
    fireEvent.click(viewerButton("Close"));

    await settle(() => request.resolve());

    expect(api.listStills).toHaveBeenCalledTimes(2);
    openStill(reopenAt);
    expect(editForm()).toBeNull();
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it.each(["save", "delete"])("keeps a %s that succeeds afterwards from closing the next viewer's edit", async (kind) => {
    await renderPage();
    const request = startHeldRequest(kind);
    fireEvent.click(viewerButton("Close"));
    openStill("00:15:00.5");
    fireEvent.click(viewerButton("Edit"));

    await settle(() => request.resolve());

    expect(api.listStills).toHaveBeenCalledTimes(2);
    expect(editForm()).not.toBeNull();
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it("lets the next viewer save while an earlier save runs, and keeps that save from re-enabling its buttons", async () => {
    await renderPage();
    const earlier = startHeldRequest("save");
    fireEvent.click(viewerButton("Close"));
    openStill("00:05:00");
    const later = deferred();
    api.updateStill.mockReturnValueOnce(later.promise);
    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));
    expect(api.updateStill).toHaveBeenCalledTimes(2);

    await settle(() => earlier.resolve());

    expect(viewerButton("Save").disabled).toBe(true);
    expect(viewerButton("Delete").disabled).toBe(true);

    await settle(() => later.reject(s3Failure()));

    expectErrorAboveStill("Failed to save the still.");
    expect(viewerButton("Save").disabled).toBe(false);
  });

  it("resets the still editor when a reload finds no stills left and closes the viewer", async () => {
    stills = [WITH_IMAGE];
    await renderPage();
    const deletion = startHeldRequest("delete");
    fireEvent.click(viewerButton("Close"));
    openStill("00:05:00");
    const save = deferred();
    api.updateStill.mockReturnValueOnce(save.promise);
    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));

    await settle(() => deletion.resolve());

    expect(screen.queryByRole("dialog", { name: "Night Diner" })).toBeNull();
    const added = { id: "a3", movie_id: "m1", time_seconds: 600, image_key: "stills/a3.png", image_url: "https://media.test/a3.png" };
    api.createStill.mockImplementation(async ({ id }) => {
      added.id = id;
      stills = [added];
      return added;
    });
    fireEvent.click(screen.getByRole("button", { name: "Add the first still" }));
    chooseFile(addDialog(), imageFile());
    typeTime(addDialog(), "10:00");
    submitAdd();
    await screen.findByRole("button", { name: "Open still at 00:10:00" });
    openStill("00:10:00");
    expect(viewerButton("Delete").disabled).toBe(false);

    await settle(() => save.reject(s3Failure()));

    expect(within(viewer()).queryByRole("alert")).toBeNull();
    expect(viewerButton("Delete").disabled).toBe(false);
  });
});

describe("visitors", () => {
  it("see the film's details with no way to edit them", async () => {
    await renderPage({ admin: false });

    expect(screen.queryByRole("button", { name: "Edit details and script" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Runtime").nextElementSibling.textContent).toBe("02:00:00");
  });

  it("see how many stills the film has, in the hero", async () => {
    await renderPage({ admin: false });

    expect(screen.getByText("2 stills")).toBeTruthy();
  });

  it("get no still editing controls", async () => {
    await renderPage({ admin: false });

    expect(screen.queryByRole("textbox", { name: "Add a still at" })).toBeNull();
    openStill("00:05:00");
    expect(within(viewer()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(viewer()).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("can't open the cover while the film has no script", async () => {
    await renderPage({ admin: false });

    expect(screen.queryByRole("button", { name: "Read the full script" })).toBeNull();
  });

  it("open the film's script from its cover", async () => {
    api.getFilmScript.mockResolvedValueOnce({ ...SCRIPT });
    await renderPage({ admin: false });

    fireEvent.click(screen.getByRole("button", { name: "Read the full script" }));

    expect(await screen.findByText("Opened script")).toBeTruthy();
  });
});
import { webcrypto } from "node:crypto";
