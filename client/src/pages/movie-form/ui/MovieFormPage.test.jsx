import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MovieFormPage from "./MovieFormPage.jsx";

const api = vi.hoisted(() => ({
  createMovie: vi.fn(),
  getMovie: vi.fn(),
  updateMovie: vi.fn(),
  updateMovieCover: vi.fn(),
  saveScript: vi.fn(),
  uploadMediaFile: vi.fn(),
}));

vi.mock("@/shared/api/movies.js", () => ({
  createMovie: api.createMovie,
  getMovie: api.getMovie,
  updateMovie: api.updateMovie,
  updateMovieCover: api.updateMovieCover,
}));
vi.mock("@/shared/api/scripts.js", () => ({ saveScript: api.saveScript }));
vi.mock("@/shared/api/uploads.js", () => ({ uploadMediaFile: api.uploadMediaFile }));
// The film save reads a script's page count straight from pdf.js.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 121 }), destroy: async () => {} }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-stub" }));
vi.mock("@/entities/session/model/useSession.js", () => ({ useSession: () => ({ user: { id: "admin-1" } }) }));

const MOVIE = {
  id: "movie-1",
  title: "Night Diner",
  director: "A. Director",
  writer: "A. Writer",
  cinematographer: "A. Camera",
  year: 2024,
  runtime_minutes: 120,
  cover_image_url: "",
};
const BAD_RUNTIME = "Runtime must use HH:MM:SS and be at least 00:01:00.";

async function renderEditPage() {
  render(
    <MemoryRouter initialEntries={["/movies/movie-1/edit"]}>
      <Routes>
        <Route path="/movies/:id/edit" element={<MovieFormPage mode="edit" />} />
        <Route path="/movies/:id" element={<h1>Saved project</h1>} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByDisplayValue("Night Diner");
}

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form"));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMovie.mockResolvedValue({ ...MOVIE });
  api.createMovie.mockImplementation(async (body) => ({ ...body }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderCreatePage() {
  return render(
    <MemoryRouter initialEntries={["/movies/new"]}>
      <Routes>
        <Route path="/movies/new" element={<MovieFormPage mode="create" />} />
        <Route path="/movies" element={<h1>Film library</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

function fillDetails() {
  fireEvent.change(screen.getByRole("textbox", { name: /^Title/ }), { target: { value: "Night Diner" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^Director/ }), { target: { value: "Ada Park" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Release year/ }), { target: { value: "2024" } });
  fireEvent.change(screen.getByPlaceholderText("00:00:00"), { target: { value: "02:00:00" } });
}

describe("MovieFormPage creation recovery", () => {
  it("restores a failed creation after reopening, with the same identity and input", async () => {
    api.createMovie.mockRejectedValueOnce(new Error("connection lost"));
    const page = renderCreatePage();
    fillDetails();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("Failed to save project.")).toBeTruthy();
    const original = api.createMovie.mock.calls[0][0];
    page.unmount();
    renderCreatePage();
    expect(screen.getByDisplayValue("Night Diner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(await screen.findByRole("heading", { name: "Film library" })).toBeTruthy();
    expect(api.createMovie.mock.calls[1][0]).toEqual(original);
  });

  it("reopens a completed upload for attachment retry without selecting the file again", async () => {
    api.uploadMediaFile.mockResolvedValue("scripts/uploaded.pdf");
    api.saveScript.mockRejectedValueOnce(new Error("attachment failed")).mockResolvedValueOnce({ id: "script-1" });
    const page = renderCreatePage();
    fillDetails();
    fireEvent.change(page.container.querySelector('input[type="file"][accept="application/pdf"]'), {
      target: { files: [new File(["script"], "script.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("Failed to save project.")).toBeTruthy();
    expect(screen.getByText(/Film details saved/)).toBeTruthy();
    page.unmount();
    renderCreatePage();
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(await screen.findByRole("heading", { name: "Film library" })).toBeTruthy();
    expect(api.createMovie).toHaveBeenCalledTimes(1);
    expect(api.uploadMediaFile).toHaveBeenCalledTimes(1);
    expect(api.saveScript).toHaveBeenCalledTimes(2);
  });
});

describe("MovieFormPage movie editing", () => {
  it("shows the shared runtime validation message without sending a request", async () => {
    await renderEditPage();
    fireEvent.change(screen.getByPlaceholderText("00:00:00"), { target: { value: "not a runtime" } });

    submit();

    expect(await screen.findByText(BAD_RUNTIME)).toBeTruthy();
    expect(api.updateMovie).not.toHaveBeenCalled();
  });

  it("saves through the shared movie-edit implementation and navigates back", async () => {
    api.updateMovie.mockResolvedValueOnce({ ...MOVIE });
    await renderEditPage();

    submit();

    await waitFor(() =>
      expect(api.updateMovie).toHaveBeenCalledWith("movie-1", {
        title: "Night Diner",
        director: "A. Director",
        writer: "A. Writer",
        cinematographer: "A. Camera",
        year: 2024,
        runtime_minutes: 120,
      })
    );
    expect(await screen.findByRole("heading", { name: "Saved project" })).toBeTruthy();
  });

  it("shows its entry-point failure message and stays on the edit route", async () => {
    api.updateMovie.mockRejectedValueOnce(new Error("save failed"));
    await renderEditPage();

    submit();

    expect(await screen.findByText("Failed to save project.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit project", level: 1 })).toBeTruthy();
  });
});
import { webcrypto } from "node:crypto";
