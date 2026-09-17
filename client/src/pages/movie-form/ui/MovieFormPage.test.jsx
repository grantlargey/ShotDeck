import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MovieFormPage from "./MovieFormPage.jsx";

const api = vi.hoisted(() => ({
  createMovie: vi.fn(),
  getMovie: vi.fn(),
  updateMovie: vi.fn(),
  saveScript: vi.fn(),
  uploadMediaFile: vi.fn(),
}));

vi.mock("@/shared/api/movies.js", () => ({
  createMovie: api.createMovie,
  getMovie: api.getMovie,
  updateMovie: api.updateMovie,
}));
vi.mock("@/shared/api/scripts.js", () => ({ saveScript: api.saveScript }));
vi.mock("@/shared/api/uploads.js", () => ({ uploadMediaFile: api.uploadMediaFile }));

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
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMovie.mockResolvedValue({ ...MOVIE });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
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
