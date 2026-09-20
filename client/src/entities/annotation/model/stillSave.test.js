import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStillSave } from "./stillSave.js";

const remote = vi.hoisted(() => ({ req: vi.fn(), upload: vi.fn() }));
vi.mock("@/shared/api/request.js", () => ({ req: remote.req }));
vi.mock("@/shared/api/uploads.js", () => ({ uploadMediaFile: remote.upload }));

const movieId = "film-1";
const file = (content = "image") => new File([content], "still.png", { type: "image/png" });
let records;

// The owned HTTP adapter's replay behavior, with faults injected around commits.
async function write(path, { method, body }) {
  const input = JSON.parse(body);
  const id = method === "POST" ? input.id : path.split("/").at(-1);
  if (method === "POST" && !records.has(id)) records.set(id, { ...input, movie_id: movieId });
  if (method === "PUT") records.set(id, { ...records.get(id), ...input });
  return { ...records.get(id) };
}

beforeEach(() => {
  records = new Map();
  remote.req.mockReset().mockImplementation(write);
  remote.upload.mockReset().mockImplementation(async ({ uploadId }) => `annotations/${movieId}/${uploadId}.png`);
});

describe("still saves through the editor's interface", () => {
  it("keeps an uploaded image when creation fails and retries with the same still identity", async () => {
    remote.req.mockRejectedValueOnce(new Error("offline"));
    const save = createStillSave({ movieId });
    const input = { timeSeconds: 10, file: file() };
    await expect(save(input)).rejects.toThrow("offline");
    const still = await save(input);
    expect(remote.upload).toHaveBeenCalledTimes(1);
    expect(remote.req.mock.calls[0]).toEqual(remote.req.mock.calls[1]);
    expect(records.size).toBe(1);
    expect(still.image_key).toContain(remote.upload.mock.calls[0][0].uploadId);
    expect(still.time_seconds).toBe(10);
  });

  it("resolves a lost creation response before applying a changed image and timestamp to the same still", async () => {
    remote.req.mockImplementationOnce(async (...args) => {
      await write(...args);
      throw new Error("response lost");
    });
    const save = createStillSave({ movieId });
    await expect(save({ timeSeconds: 10, file: file("first") })).rejects.toThrow("response lost");
    const original = [...records.values()][0];
    const still = await save({ timeSeconds: 20, file: file("replacement") });
    expect(records.size).toBe(1);
    expect(still.id).toBe(original.id);
    expect(still.time_seconds).toBe(20);
    expect(still.image_key).not.toBe(original.image_key);
    expect(remote.req.mock.calls.map(([, options]) => options.method)).toEqual(["POST", "POST", "PUT"]);
    expect(remote.req.mock.calls[0]).toEqual(remote.req.mock.calls[1]);
  });

  it("does not overwrite later edits when replaying an unchanged creation", async () => {
    remote.req.mockImplementationOnce(async (...args) => {
      const saved = await write(...args);
      records.set(saved.id, { ...saved, time_seconds: 99 });
      throw new Error("response lost");
    });
    const save = createStillSave({ movieId });
    const input = { timeSeconds: 10, file: file() };
    await expect(save(input)).rejects.toThrow();
    expect((await save(input)).time_seconds).toBe(99);
    expect(remote.req.mock.calls.every(([, options]) => options.method === "POST")).toBe(true);
  });

  it("reuses an uncertain upload identity, and changes it for a replacement file with the same name", async () => {
    remote.upload.mockRejectedValueOnce(new Error("PUT response lost"));
    remote.req.mockRejectedValueOnce(new Error("record failed"));
    const save = createStillSave({ movieId, stillId: "still-1" });
    const input = { timeSeconds: 10, file: file() };
    await expect(save(input)).rejects.toThrow("PUT response lost");
    await expect(save(input)).rejects.toThrow("record failed");
    await save({ timeSeconds: 10, file: file("replacement") });
    const identities = remote.upload.mock.calls.map(([args]) => args.uploadId);
    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).not.toBe(identities[1]);
  });

  it("retries only the record when replacing an image, and retains acknowledged completion", async () => {
    remote.req.mockRejectedValueOnce(new Error("offline"));
    const save = createStillSave({ movieId, stillId: "still-1" });
    const input = { timeSeconds: 10, file: file() };
    await expect(save(input)).rejects.toThrow("offline");
    const saved = await save(input);
    expect(await save(input)).toEqual(saved);
    expect(remote.upload).toHaveBeenCalledTimes(1);
    expect(remote.req).toHaveBeenCalledTimes(2);
    expect(remote.req.mock.calls[0]).toEqual(remote.req.mock.calls[1]);
  });

  it("saves a timestamp with the existing image without uploading", async () => {
    const save = createStillSave({ movieId, stillId: "still-1" });
    await save({ timeSeconds: 20, imageKey: "existing.png" });
    expect(remote.upload).not.toHaveBeenCalled();
    expect(records.get("still-1")).toMatchObject({ time_seconds: 20, image_key: "existing.png" });
  });

  it("refuses a second submission while the upload is pending", async () => {
    let finish;
    remote.upload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const save = createStillSave({ movieId });
    const input = { timeSeconds: 10, file: file() };
    const pending = save(input);
    await expect(save(input)).rejects.toThrow("already in progress");
    finish("uploaded.png");
    await pending;
    expect(remote.upload).toHaveBeenCalledTimes(1);
    expect(records.size).toBe(1);
  });
});
