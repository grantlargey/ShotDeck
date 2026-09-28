import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { listStills } from "@/shared/api/stills.js";
import { listScriptScenes } from "@/shared/api/scriptScenes.js";
import { useSceneViewer } from "./useSceneViewer.js";
vi.mock("@/shared/api/stills.js", () => ({ listStills: vi.fn() }));
vi.mock("@/shared/api/scriptScenes.js", () => ({ listScriptScenes: vi.fn() }));
const scene = (id, start, movie = "m1") => ({ id, movie_id: movie, movie_title: movie,
  script_id: `${movie}-script`, script_location: { start: { page: 1, y: start }, end: { page: 1, y: start + 9 } }, start_time_seconds: start, end_time_seconds: start + 9 });
const still = (id, time_seconds) => ({ id, time_seconds, image_key: `annotations/${id}.jpg` });
beforeEach(() => { vi.resetAllMocks(); listStills.mockResolvedValue([]); listScriptScenes.mockResolvedValue([]); });

it("resolves owned lists, follows tabs, and adopts edits and deleted stills", () => {
  const scenes = [scene("a", 10), scene("b", 30)];
  const stills = [still("x", 12), still("y", 32)];
  const { result, rerender } = renderHook(({ rows }) => useSceneViewer({
    initial: { view: "still", stillId: "x" },
    source: { film: { id: "m1", scriptId: "m1-script", stills: rows, scriptScenes: scenes } },
  }), { initialProps: { rows: stills } });
  expect(result.current.scene.id).toBe("a");
  act(() => result.current.step(1));
  expect(result.current.scene.id).toBe("b");
  act(() => result.current.setView("script"));
  act(() => result.current.step(-1));
  expect(result.current.still.id).toBe("x");
  act(() => result.current.setView("still"));
  act(() => result.current.step(1));
  rerender({ rows: [still("replacement", 31)] });
  expect(result.current.still.id).toBe("replacement");
  expect(listStills).not.toHaveBeenCalled();
  expect(listScriptScenes).not.toHaveBeenCalled();
});

it("loads search films by owner and resumes the result list after an unlisted scene", async () => {
  const listed = [scene("a", 10), scene("b", 50), scene("c", 0, "m2")];
  listStills.mockImplementation(async (id) => id === "m1" ? [still("x", 12), still("y", 32)] : []);
  listScriptScenes.mockImplementation(async (id) => id === "m1" ? [listed[0], scene("unlisted", 30), listed[1]] : [listed[2]]);
  const { result } = renderHook(() => useSceneViewer({ initial: { sceneId: "a" }, source: { scenes: listed } }));
  await waitFor(() => expect(result.current.still?.id).toBe("x"));
  act(() => result.current.setView("still"));
  act(() => result.current.step(1));
  expect(result.current.scene.id).toBe("unlisted");
  act(() => result.current.setView("script"));
  expect(result.current.counter).toBeNull();
  act(() => result.current.step(1));
  expect(result.current.scene.id).toBe("b");
  act(() => result.current.step(1));
  expect(result.current.movieId).toBe("m2");
  await waitFor(() => expect(listStills).toHaveBeenCalledWith("m2"));
  act(() => result.current.step(-1));
  await waitFor(() => expect(result.current.movieId).toBe("m1"));
  expect(listStills).toHaveBeenCalledTimes(2);
});

it("reports failed scene loads and a missing script separately", async () => {
  listScriptScenes.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useSceneViewer({ initial: { view: "still", stillId: "x" },
    source: { film: { id: "m1", scriptId: "m1-script", stills: [still("x", 1)] } } }));
  expect(result.current.sceneStatus).toBe("loading");
  await waitFor(() => expect(result.current.sceneStatus).toBe("failed"));
});
