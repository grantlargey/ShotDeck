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
 * No test uploads a file: the stills API module is mocked.
 */

const api = vi.hoisted(() => ({
  getMovie: vi.fn(),
  updateMovie: vi.fn(),
  listScripts: vi.fn(),
  saveScript: vi.fn(),
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  updateAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  listScriptScenes: vi.fn(),
  getViewUrlForKey: vi.fn(),
}));
const session = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("@/shared/api/annotations.js", () => ({
  listAnnotations: api.listAnnotations,
  createAnnotation: api.createAnnotation,
  updateAnnotation: api.updateAnnotation,
  deleteAnnotation: api.deleteAnnotation,
}));
vi.mock("@/shared/api/movies.js", () => ({ getMovie: api.getMovie, updateMovie: api.updateMovie }));
vi.mock("@/shared/api/scripts.js", () => ({ listScripts: api.listScripts, saveScript: api.saveScript }));
vi.mock("@/shared/api/scriptScenes.js", () => ({ listScriptScenes: api.listScriptScenes }));
vi.mock("@/shared/api/uploads.js", () => ({ getViewUrlForKey: api.getViewUrlForKey }));
vi.mock("@/entities/session/model/useSession.js", () => ({ useSession: () => session }));

// jsdom has no object URLs; the add dialog previews the picked image with one.
URL.createObjectURL ??= () => "blob:still-preview";
URL.revokeObjectURL ??= () => {};

const MOVIE = { id: "m1", title: "Night Diner", runtime_minutes: 120 };
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

async function openAddDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Add still" }));
  return addDialog();
}

function submitAdd() {
  fireEvent.click(within(addDialog()).getByRole("button", { name: /^(Add still|Adding…)$/ }));
}

beforeEach(() => {
  stills = [WITH_IMAGE, WITHOUT_IMAGE];
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMovie.mockImplementation(async () => ({ ...MOVIE }));
  api.listScripts.mockImplementation(async () => []);
  api.listAnnotations.mockImplementation(async () => stills.map((row) => ({ ...row })));
  api.listScriptScenes.mockImplementation(async () => []);
  api.getViewUrlForKey.mockImplementation(async () => ({ url: "" }));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("disables submit while adding, then shows an upload failure in the dialog and keeps it open", async () => {
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
    expect(api.createAnnotation).toHaveBeenCalledTimes(1);
    expect(api.createAnnotation).toHaveBeenCalledWith({ movieId: "m1", timeSeconds: 600, file });

    await act(async () => request.reject(s3Failure()));

    expect(queryAddDialog()).not.toBeNull();
    expect(within(addDialog()).getByRole("alert").textContent).toBe("Failed to add the still.");
    expect(within(addDialog()).getByRole("button", { name: "Add still" }).disabled).toBe(false);
    expect(api.listAnnotations).toHaveBeenCalledTimes(1);
  });

  it("closes the dialog and refreshes the stills once the still is saved", async () => {
    await renderPage();
    const added = { id: "a3", movie_id: "m1", time_seconds: 600, image_key: "stills/a3.png", image_url: "https://media.test/a3.png" };
    api.createAnnotation.mockImplementation(async () => {
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
      imageKey: null,
      file,
    });
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
      file: null,
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
