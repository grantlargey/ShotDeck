import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScriptScene,
  deleteScriptScene,
  listScriptScenes,
  updateScriptScene,
} from "@/shared/api/scriptScenes.js";
import { useSceneCollection } from "./sceneCollection.js";

/*
 * Interface tests for the script's captured scene collection, with the
 * captured-scene API owner doubled. They cover what the page suite can't pin
 * precisely: the list's order after each response, which request is running,
 * and what reaches the draft's callbacks.
 */

vi.mock("@/shared/api/scriptScenes.js", () => ({
  listScriptScenes: vi.fn(),
  createScriptScene: vi.fn(),
  updateScriptScene: vi.fn(),
  deleteScriptScene: vi.fn(),
}));

/** A stored captured scene, with the fields the list order reads. */
function sceneRow(id, fields = {}) {
  return {
    id,
    movie_id: "m1",
    script_id: "s1",
    page_start: null,
    page_end: null,
    start_time_seconds: 0,
    end_time_seconds: 60,
    created_at: "2026-09-01T00:00:00.000Z",
    ...fields,
  };
}

/** What the draft's buildSave would hand over; the collection never reads it. */
const PAYLOAD = { start_time_seconds: 600, end_time_seconds: 660, formatted_selected_text: "## INT. DINER" };

function ids(rows) {
  return rows.map((row) => row.id);
}

/** A request the test settles itself. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderCollection(rows = []) {
  listScriptScenes.mockResolvedValue(rows);
  const view = renderHook(() => useSceneCollection({ movieId: "m1", scriptId: "s1" }));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useSceneCollection", () => {
  describe("loading", () => {
    it("loads the script's captured scenes and puts them in the API's list order", async () => {
      listScriptScenes.mockResolvedValue([
        sceneRow("p5", { page_start: 5 }),
        sceneRow("unplaced", { start_time_seconds: 10 }),
        sceneRow("p1", { page_start: 1 }),
      ]);
      const { result } = renderHook(() => useSceneCollection({ movieId: "m1", scriptId: "s1" }));

      expect(result.current.loading).toBe(true);
      expect(result.current.list).toEqual([]);

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(listScriptScenes).toHaveBeenCalledWith("m1", "s1");
      expect(ids(result.current.list)).toEqual(["p1", "p5", "unplaced"]);
      expect(result.current.loadError).toBeNull();
      expect(result.current.saving).toBe(false);
      expect(result.current.deletingSceneId).toBe("");
    });

    it("reports a failed load and keeps the list empty", async () => {
      const error = new Error("GET scene-annotations failed: 500");
      listScriptScenes.mockRejectedValue(error);
      const { result } = renderHook(() => useSceneCollection({ movieId: "m1", scriptId: "s1" }));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.loadError).toBe(error);
      expect(result.current.list).toEqual([]);
    });

    it("treats a response that isn't a list as no captured scenes", async () => {
      const { result } = await renderCollection(null);
      expect(result.current.list).toEqual([]);
      expect(result.current.loadError).toBeNull();
    });
  });

  describe("saving", () => {
    it("creates a scene, then updates the scene the create returned", async () => {
      const { result } = await renderCollection([sceneRow("p1", { page_start: 1 })]);
      const created = sceneRow("scene-new", { page_start: 3 });
      createScriptScene.mockResolvedValue(created);
      const applySaved = vi.fn();

      let saved;
      await act(async () => {
        saved = await result.current.save({ payload: PAYLOAD, applySaved });
      });

      expect(createScriptScene).toHaveBeenCalledWith("m1", "s1", PAYLOAD);
      expect(updateScriptScene).not.toHaveBeenCalled();
      expect(saved).toEqual({ ok: true, scene: created });
      expect(applySaved).toHaveBeenCalledWith(created);
      expect(ids(result.current.list)).toEqual(["p1", "scene-new"]);

      // The next save updates the created scene instead of adding another one.
      const updated = sceneRow("scene-new", { page_start: 1, start_time_seconds: 5 });
      updateScriptScene.mockResolvedValue(updated);
      await act(async () => {
        await result.current.save({ sceneId: saved.scene.id, payload: PAYLOAD, applySaved });
      });

      expect(updateScriptScene).toHaveBeenCalledWith("m1", "s1", "scene-new", PAYLOAD);
      expect(createScriptScene).toHaveBeenCalledTimes(1);
      expect(applySaved).toHaveBeenLastCalledWith(updated);
      // Replaced, not duplicated, and re-ordered by its new first page.
      expect(result.current.list).toEqual([sceneRow("p1", { page_start: 1 }), updated]);
    });

    it("is saving while the request runs", async () => {
      const { result } = await renderCollection();
      const request = deferred();
      createScriptScene.mockReturnValue(request.promise);
      const scene = sceneRow("scene-new", { page_start: 1 });

      let pending;
      act(() => {
        pending = result.current.save({ payload: PAYLOAD, applySaved: vi.fn() });
      });
      expect(result.current.saving).toBe(true);
      expect(result.current.list).toEqual([]);

      await act(async () => {
        request.resolve(scene);
        await pending;
      });
      expect(result.current.saving).toBe(false);
      expect(ids(result.current.list)).toEqual(["scene-new"]);
    });

    it("leaves the list unchanged and reports the error when a save fails", async () => {
      const rows = [sceneRow("p1", { page_start: 1 })];
      const { result } = await renderCollection(rows);
      const before = result.current.list;
      const error = new Error("POST scene-annotations failed: 409");
      createScriptScene.mockRejectedValue(error);
      const applySaved = vi.fn();

      let saved;
      await act(async () => {
        saved = await result.current.save({ payload: PAYLOAD, applySaved });
      });

      expect(saved).toEqual({ ok: false, error });
      expect(applySaved).not.toHaveBeenCalled();
      expect(result.current.list).toBe(before);
      expect(result.current.saving).toBe(false);
    });
  });

  describe("deleting", () => {
    it("prepares the draft's deletion before the request and completes it once the scene is gone", async () => {
      const { result } = await renderCollection([
        sceneRow("p1", { page_start: 1 }),
        sceneRow("p2", { page_start: 2 }),
      ]);
      const request = deferred();
      deleteScriptScene.mockReturnValue(request.promise);
      const completeDelete = vi.fn();
      const prepareDelete = vi.fn(() => completeDelete);

      let pending;
      act(() => {
        pending = result.current.remove({ sceneId: "p1", prepareDelete });
      });

      expect(prepareDelete).toHaveBeenCalledWith("p1");
      expect(completeDelete).not.toHaveBeenCalled();
      expect(deleteScriptScene).toHaveBeenCalledWith("m1", "s1", "p1");
      expect(result.current.deletingSceneId).toBe("p1");
      expect(ids(result.current.list)).toEqual(["p1", "p2"]);

      let removed;
      await act(async () => {
        request.resolve();
        removed = await pending;
      });

      expect(removed).toEqual({ ok: true });
      expect(completeDelete).toHaveBeenCalledTimes(1);
      expect(ids(result.current.list)).toEqual(["p2"]);
      expect(result.current.deletingSceneId).toBe("");
    });

    it("keeps the scene and doesn't complete the draft's deletion when the request fails", async () => {
      const { result } = await renderCollection([sceneRow("p1", { page_start: 1 })]);
      const before = result.current.list;
      const error = new Error("DELETE scene-annotations failed: 500");
      deleteScriptScene.mockRejectedValue(error);
      const completeDelete = vi.fn();

      let removed;
      await act(async () => {
        removed = await result.current.remove({ sceneId: "p1", prepareDelete: () => completeDelete });
      });

      expect(removed).toEqual({ ok: false, error });
      expect(completeDelete).not.toHaveBeenCalled();
      expect(result.current.list).toBe(before);
      expect(result.current.deletingSceneId).toBe("");
    });
  });
});
