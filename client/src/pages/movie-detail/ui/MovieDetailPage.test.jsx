import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/lib/errors.js";
import MovieDetailPage from "./MovieDetailPage.jsx";

/*
 * Still editing on the project page: adding a still, editing its timestamp or
 * image in the scene viewer, and deleting it. Only external edges are doubled
 * (the API modules and the session); the page, the scene viewer and the form
 * controls are real, so error placement is checked where people see it.
 * Still-save orchestration is real; upload and record requests are mocked.
 */

const api = vi.hoisted(() => ({
  getMovie: vi.fn(),
  updateMovie: vi.fn(),
  getMovieScript: vi.fn(),
  saveScript: vi.fn(),
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  updateAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  listScriptScenes: vi.fn(),
  getViewUrlForKey: vi.fn(),
  uploadMediaFile: vi.fn(),
}));
const session = vi.hoisted(() => ({ isAdmin: true, user: { id: "admin-1" } }));

vi.mock("@/shared/api/annotations.js", () => ({
  listAnnotations: api.listAnnotations,
  createAnnotation: api.createAnnotation,
  updateAnnotation: api.updateAnnotation,
  deleteAnnotation: api.deleteAnnotation,
}));
vi.mock("@/shared/api/movies.js", () => ({ getMovie: api.getMovie, updateMovie: api.updateMovie }));
vi.mock("@/shared/api/scripts.js", () => ({ getMovieScript: api.getMovieScript, saveScript: api.saveScript }));
vi.mock("@/shared/api/scriptScenes.js", () => ({ listScriptScenes: api.listScriptScenes }));
vi.mock("@/shared/api/uploads.js", () => ({ getViewUrlForKey: api.getViewUrlForKey, uploadMediaFile: api.uploadMediaFile }));
vi.mock("@/entities/session/model/useSession.js", () => ({ useSession: () => session }));

// jsdom has no object URLs; the add dialog previews the picked image with one.
URL.createObjectURL ??= () => "blob:still-preview";
URL.revokeObjectURL ??= () => {};

const MOVIE = { id: "m1", title: "Night Diner", runtime_minutes: 120 };
const SCRIPT = { id: "s1", movie_id: "m1", s3_key: "scripts/m1.pdf", script_url: "https://media.test/m1.pdf" };
const RUNTIME_LABEL = "02:00:00";
const WITH_IMAGE = {
  id: "a1",
  movie_id: "m1",
  time_seconds: 300,
  image_key: "stills/a1.jpg",
  image_url: "https://media.test/a1.jpg",
};
const WITHOUT_IMAGE = { id: "a2", movie_id: "m1", time_seconds: 900, image_key: null, image_url: null };

const BAD_TIME = "Use HH:MM:SS (or MM:SS) for the timestamp.";
const PAST_RUNTIME = `The timestamp can't be later than the film's runtime (${RUNTIME_LABEL}).`;
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
    <MemoryRouter initialEntries={["/movies/m1"]}>
      <Routes>
        <Route path="/movies/:id" element={<MovieDetailPage />} />
        <Route path="/movies/:movieId/scripts/:scriptId" element={<p>Opened script</p>} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { name: "Night Diner", level: 1 });
  await waitFor(() => expect(screen.getByRole("heading", { name: /Film stills/ }).closest("section").getAttribute("aria-busy")).toBe("false"));
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
    api.updateAnnotation.mockReturnValueOnce(request.promise);
    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));
  } else {
    window.confirm.mockReturnValue(true);
    api.deleteAnnotation.mockImplementationOnce(async (movieId, annotationId) => {
      await request.promise;
      stills = stills.filter((row) => row.id !== annotationId);
    });
    fireEvent.click(viewerButton("Delete"));
  }
  return request;
}

async function openAddDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Add still" }));
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
  api.getMovie.mockImplementation(async () => ({ ...MOVIE }));
  api.getMovieScript.mockImplementation(async () => null);
  api.listAnnotations.mockImplementation(async () => stills.map((row) => ({ ...row })));
  api.listScriptScenes.mockImplementation(async () => []);
  api.getViewUrlForKey.mockImplementation(async () => ({ url: "" }));
  api.uploadMediaFile.mockResolvedValue("annotations/m1/upload.png");
  api.createAnnotation.mockImplementation(async ({ id, timeSeconds, imageKey }) => ({ id, movie_id: "m1", time_seconds: timeSeconds, image_key: imageKey }));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loading the project's script", () => {
  it("does not replay a canceled script replacement when later saving film details", async () => {
    api.uploadMediaFile.mockResolvedValue("scripts/m1/canceled.pdf");
    api.saveScript.mockRejectedValueOnce(new Error("attachment failed"));
    await renderPage();
    const section = screen.getByRole("region", { name: /^Script/ });
    chooseFile(section, new File(["replacement"], "replacement.pdf", { type: "application/pdf" }));
    fireEvent.click(within(section).getByRole("button", { name: "Upload PDF" }));
    await screen.findByText("Failed to save script PDF.");
    window.confirm.mockReturnValue(true);
    fireEvent.click(within(section).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Resume film save" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Title/ }), { target: { value: "Updated title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateMovie).toHaveBeenCalledTimes(1));
    expect(api.saveScript).toHaveBeenCalledTimes(1);
    expect(api.uploadMediaFile).toHaveBeenCalledTimes(1);
  });

  it("does not replay canceled film details when later uploading a script", async () => {
    api.updateMovie.mockRejectedValueOnce(new Error("details failed"));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Title/ }), { target: { value: "Canceled title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Failed to save project details.");
    window.confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    api.uploadMediaFile.mockResolvedValue("scripts/m1/replacement.pdf");
    api.saveScript.mockResolvedValue(SCRIPT);
    const section = screen.getByRole("region", { name: /^Script/ });
    chooseFile(section, new File(["replacement"], "replacement.pdf", { type: "application/pdf" }));
    fireEvent.click(within(section).getByRole("button", { name: "Upload PDF" }));
    expect(await screen.findByRole("button", { name: "Open script" })).toBeTruthy();
    expect(api.updateMovie).toHaveBeenCalledTimes(1);
    expect(api.saveScript).toHaveBeenCalledTimes(1);
  });

  it("retries a standalone script attachment without uploading it again", async () => {
    api.uploadMediaFile.mockResolvedValue("scripts/m1/upload.pdf");
    api.saveScript.mockRejectedValueOnce(new Error("attachment failed")).mockResolvedValueOnce(SCRIPT);
    await renderPage();
    const section = screen.getByRole("region", { name: /^Script/ });
    chooseFile(section, new File(["script"], "script.pdf", { type: "application/pdf" }));
    fireEvent.click(within(section).getByRole("button", { name: "Upload PDF" }));
    expect(await screen.findByText("Failed to save script PDF.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resume film save" }).getAttribute("href")).toBe("/movies/m1/edit");
    fireEvent.click(within(section).getByRole("button", { name: "Upload PDF" }));
    expect(await screen.findByRole("button", { name: "Open script" })).toBeTruthy();
    expect(api.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect(api.saveScript).toHaveBeenCalledTimes(2);
    expect(api.saveScript).toHaveBeenLastCalledWith({ movieId: "m1", key: "scripts/m1/upload.pdf" });
  });

  it("consumes the one script object and opens it", async () => {
    api.getMovieScript.mockResolvedValueOnce({ ...SCRIPT });

    await renderPage();

    expect(api.getMovieScript).toHaveBeenCalledWith("m1");
    expect(screen.getByText("Uploaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open script" }));
    expect(await screen.findByText("Opened script")).toBeTruthy();
  });

  it("consumes null without keeping a script selection", async () => {
    await renderPage();

    expect(api.getMovieScript).toHaveBeenCalledWith("m1");
    expect(screen.getByText("Not uploaded")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open script" })).toBeNull();
  });
});

describe("editing project details inline", () => {
  it("shows the shared runtime validation message without sending a request", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByPlaceholderText("00:00:00"), { target: { value: "not a runtime" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(BAD_RUNTIME)).toBeTruthy();
    expect(api.updateMovie).not.toHaveBeenCalled();
  });

  it("saves through the shared movie-edit implementation and closes the editor", async () => {
    api.updateMovie.mockResolvedValueOnce({ ...MOVIE });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.updateMovie).toHaveBeenCalledWith("m1", {
        title: "Night Diner",
        director: "",
        writer: null,
        cinematographer: null,
        year: null,
        runtime_minutes: 120,
      })
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit details" })).toBeNull());
  });

  it("shows its entry-point failure message and keeps the editor open", async () => {
    api.updateMovie.mockRejectedValueOnce(new Error("save failed"));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Failed to save project details.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit details" })).toBeTruthy();
  });
});

describe("adding a still", () => {
  it("rejects a malformed timestamp and one past the runtime, in the dialog", async () => {
    await renderPage();
    const dialog = await openAddDialog();
    chooseFile(dialog, imageFile());

    typeTime(dialog, "12:ab");
    submitAdd();
    expect(within(addDialog()).getByRole("alert").textContent).toBe(BAD_TIME);

    typeTime(dialog, "02:00:01");
    submitAdd();
    expect(within(addDialog()).getByRole("alert").textContent).toBe(PAST_RUNTIME);

    expect(api.createAnnotation).not.toHaveBeenCalled();
  });

  it("requires an image", async () => {
    await renderPage();
    const dialog = await openAddDialog();

    typeTime(dialog, "10:00");
    submitAdd();

    expect(within(addDialog()).getByRole("alert").textContent).toBe("Choose a still image to add.");
    expect(api.createAnnotation).not.toHaveBeenCalled();
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
    expect(typeTime(dialog, "1:2:3:4").value).toBe("1:2:3:4");
    expect(within(dialog).getByText(`Between 00:00:00 and ${RUNTIME_LABEL}`)).toBeTruthy();
  });

  it("disables submit while adding, then shows a record failure in the dialog and keeps it open", async () => {
    await renderPage();
    const request = deferred();
    api.createAnnotation.mockReturnValue(request.promise);
    const dialog = await openAddDialog();
    const file = imageFile();
    chooseFile(dialog, file);
    typeTime(dialog, "10:00");

    submitAdd();

    const busy = within(addDialog()).getByRole("button", { name: "Adding…" });
    expect(busy.disabled).toBe(true);
    await waitFor(() => expect(api.createAnnotation).toHaveBeenCalledTimes(1));
    expect(api.createAnnotation).toHaveBeenCalledWith({ movieId: "m1", id: expect.any(String), timeSeconds: 600, imageKey: "annotations/m1/upload.png" });

    await act(async () => request.reject(s3Failure()));

    expect(queryAddDialog()).not.toBeNull();
    expect(within(addDialog()).getByRole("alert").textContent).toBe("Failed to add the still.");
    expect(within(addDialog()).getByRole("button", { name: "Add still" }).disabled).toBe(false);
    expect(api.listAnnotations).toHaveBeenCalledTimes(1);
  });

  it("closes the dialog and refreshes the stills once the still is saved", async () => {
    await renderPage();
    const added = { id: "a3", movie_id: "m1", time_seconds: 600, image_key: "stills/a3.png", image_url: "https://media.test/a3.png" };
    api.createAnnotation.mockImplementation(async ({ id }) => {
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
    expect(api.listAnnotations).toHaveBeenCalledTimes(2);
  });

  it("retries a failed creation with the uploaded image and applies changed timing to the same still", async () => {
    await renderPage();
    api.createAnnotation.mockRejectedValueOnce(new Error("response lost"));
    const dialog = await openAddDialog();
    chooseFile(dialog, imageFile());
    typeTime(dialog, "10:00");
    submitAdd();
    await waitFor(() => expect(within(addDialog()).getByRole("alert").textContent).toBe("Failed to add the still."));
    const original = api.createAnnotation.mock.calls[0][0];

    typeTime(dialog, "11:00");
    submitAdd();
    await waitFor(() => expect(queryAddDialog()).toBeNull());
    expect(api.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect(api.createAnnotation.mock.calls[1][0]).toEqual(original);
    expect(api.updateAnnotation).toHaveBeenCalledWith({ movieId: "m1", annotationId: original.id, timeSeconds: 660, imageKey: original.imageKey });
  });

  it.each(["success", "failure"])("keeps an earlier add's %s out of a reopened dialog", async (outcome) => {
    await renderPage();
    const earlier = deferred();
    const later = deferred();
    api.createAnnotation.mockImplementationOnce(async ({ id }) => {
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
    await waitFor(() => expect(api.createAnnotation).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    dialog = await openAddDialog();
    chooseFile(dialog, imageFile());
    typeTime(dialog, "11:00");
    submitAdd();
    await waitFor(() => expect(api.createAnnotation).toHaveBeenCalledTimes(2));
    expect(api.createAnnotation.mock.calls[0][0].id).not.toBe(api.createAnnotation.mock.calls[1][0].id);
    await settle(() => outcome === "success" ? earlier.resolve() : earlier.reject(new Error("offline")));
    expect(within(addDialog()).getByRole("button", { name: "Adding…" }).disabled).toBe(true);
    expect(within(addDialog()).queryByRole("alert")).toBeNull();
    expect(within(addDialog()).getByPlaceholderText("HH:MM:SS").value).toBe("00:11:00");
    await settle(() => later.resolve());
    expect(queryAddDialog()).toBeNull();
  });

  it("opens with an empty form each time", async () => {
    await renderPage();
    let dialog = await openAddDialog();
    typeTime(dialog, "12:ab");
    submitAdd();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(queryAddDialog()).toBeNull();

    dialog = await openAddDialog();
    expect(within(dialog).getByPlaceholderText("HH:MM:SS").value).toBe("");
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

describe("editing a still in the viewer", () => {
  it("shows a save failure above the still and keeps the edit open", async () => {
    await renderPage();
    api.updateAnnotation.mockRejectedValue(s3Failure());
    openStill("00:05:00");

    fireEvent.click(viewerButton("Edit"));
    typeTime(editForm(), "6:00");
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expectErrorAboveStill("Failed to save the still."));
    expect(editForm()).not.toBeNull();
    expect(api.listAnnotations).toHaveBeenCalledTimes(1);
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

    expect(api.updateAnnotation).not.toHaveBeenCalled();
  });

  it("requires an image when the still has none", async () => {
    await renderPage();
    api.updateAnnotation.mockResolvedValue({ ...WITHOUT_IMAGE });
    openStill("00:15:00");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Save"));
    await waitFor(() => expectErrorAboveStill("Choose an image for this still."));
    expect(api.updateAnnotation).not.toHaveBeenCalled();

    const file = imageFile("replacement.png");
    chooseFile(editForm(), file);
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expect(editForm()).toBeNull());
    expect(api.updateAnnotation).toHaveBeenCalledWith({
      movieId: "m1",
      annotationId: "a2",
      timeSeconds: 900,
      imageKey: "annotations/m1/upload.png",
    });
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it("saves the timestamp with the current image, refreshes the stills and clears the edit", async () => {
    await renderPage();
    api.updateAnnotation.mockImplementation(async ({ timeSeconds }) => {
      stills = stills.map((row) => (row.id === "a1" ? { ...row, time_seconds: timeSeconds } : row));
      return stills[0];
    });
    openStill("00:05:00");

    fireEvent.click(viewerButton("Edit"));
    expect(within(viewer()).getByRole("textbox", { name: "Timestamp" }).value).toBe("00:05:00");
    expect(typeTime(editForm(), "6:00").value).toBe("00:06:00");
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expect(editForm()).toBeNull());
    expect(api.updateAnnotation).toHaveBeenCalledWith({
      movieId: "m1",
      annotationId: "a1",
      timeSeconds: 360,
      imageKey: "stills/a1.jpg",
    });
    expect(api.listAnnotations).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Open still at 00:06:00" })).toBeTruthy();
    expect(viewerButton("Edit")).toBeTruthy();
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it("shows a failed reload after saving above the still", async () => {
    await renderPage();
    api.updateAnnotation.mockResolvedValue({ ...WITH_IMAGE });
    api.listAnnotations.mockRejectedValueOnce(new Error("connection reset"));
    openStill("00:05:00");

    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));

    await waitFor(() => expectErrorAboveStill("Failed to load project."));
    expect(editForm()).toBeNull();
  });

  it("disables Save and Delete while saving, so a double click sends one request", async () => {
    await renderPage();
    const request = deferred();
    api.updateAnnotation.mockReturnValue(request.promise);
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Save"));
    fireEvent.click(viewerButton("Save"));

    expect(api.updateAnnotation).toHaveBeenCalledTimes(1);
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
    expect(api.deleteAnnotation).not.toHaveBeenCalled();
    expect(viewer()).toBeTruthy();
  });

  it("shows a delete failure above the still", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    api.deleteAnnotation.mockRejectedValue(s3Failure());
    openStill("00:05:00");

    fireEvent.click(viewerButton("Delete"));

    await waitFor(() => expectErrorAboveStill("Failed to delete the still."));
    expect(api.listAnnotations).toHaveBeenCalledTimes(1);
  });

  it("deletes the still, clears its edit and refreshes the stills", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    api.deleteAnnotation.mockImplementation(async (movieId, annotationId) => {
      stills = stills.filter((row) => row.id !== annotationId);
    });
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Delete"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Open still at 00:05:00" })).toBeNull());
    expect(api.deleteAnnotation).toHaveBeenCalledWith("m1", "a1");
    expect(api.listAnnotations).toHaveBeenCalledTimes(2);
    expect(editForm()).toBeNull();
  });

  it("disables Delete and Save while deleting, so a double click sends one request", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    const request = deferred();
    api.deleteAnnotation.mockReturnValue(request.promise);
    openStill("00:05:00");
    fireEvent.click(viewerButton("Edit"));

    fireEvent.click(viewerButton("Delete"));
    fireEvent.click(viewerButton("Delete"));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(api.deleteAnnotation).toHaveBeenCalledTimes(1);
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
    api.deleteAnnotation.mockRejectedValueOnce(s3Failure()).mockImplementationOnce(async (movieId, annotationId) => {
      stills = stills.filter((row) => row.id !== annotationId);
    });
    openStill("00:05:00");
    fireEvent.click(viewerButton("Delete"));
    await waitFor(() => expectErrorAboveStill("Failed to delete the still."));

    fireEvent.click(viewerButton("Delete"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Open still at 00:05:00" })).toBeNull());
    expect(api.deleteAnnotation).toHaveBeenCalledTimes(2);
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });
});

describe("closing the viewer", () => {
  it("drops the still edit and its error", async () => {
    await renderPage();
    window.confirm.mockReturnValue(true);
    api.deleteAnnotation.mockRejectedValue(s3Failure());
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
    expect(api.listAnnotations).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["save", "00:05:00"],
    ["delete", "00:15:00"],
  ])("still refreshes the stills when a %s succeeds afterwards", async (kind, reopenAt) => {
    await renderPage();
    const request = startHeldRequest(kind);
    fireEvent.click(viewerButton("Close"));

    await settle(() => request.resolve());

    expect(api.listAnnotations).toHaveBeenCalledTimes(2);
    openStill(reopenAt);
    expect(editForm()).toBeNull();
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it.each(["save", "delete"])("keeps a %s that succeeds afterwards from closing the next viewer's edit", async (kind) => {
    await renderPage();
    const request = startHeldRequest(kind);
    fireEvent.click(viewerButton("Close"));
    openStill("00:15:00");
    fireEvent.click(viewerButton("Edit"));

    await settle(() => request.resolve());

    expect(api.listAnnotations).toHaveBeenCalledTimes(2);
    expect(editForm()).not.toBeNull();
    expect(within(viewer()).queryByRole("alert")).toBeNull();
  });

  it("lets the next viewer save while an earlier save runs, and keeps that save from re-enabling its buttons", async () => {
    await renderPage();
    const earlier = startHeldRequest("save");
    fireEvent.click(viewerButton("Close"));
    openStill("00:05:00");
    const later = deferred();
    api.updateAnnotation.mockReturnValueOnce(later.promise);
    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));
    expect(api.updateAnnotation).toHaveBeenCalledTimes(2);

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
    api.updateAnnotation.mockReturnValueOnce(save.promise);
    fireEvent.click(viewerButton("Edit"));
    fireEvent.click(viewerButton("Save"));

    await settle(() => deletion.resolve());

    expect(screen.queryByRole("dialog", { name: "Night Diner" })).toBeNull();
    const added = { id: "a3", movie_id: "m1", time_seconds: 600, image_key: "stills/a3.png", image_url: "https://media.test/a3.png" };
    api.createAnnotation.mockImplementation(async ({ id }) => {
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
  it("get no still editing controls", async () => {
    await renderPage({ admin: false });

    expect(screen.queryByRole("button", { name: "Add still" })).toBeNull();
    openStill("00:05:00");
    expect(within(viewer()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(viewer()).queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
import { webcrypto } from "node:crypto";
