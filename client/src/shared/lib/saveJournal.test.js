import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSaveJournal } from "./saveJournal.js";

const DETAILS = "details";
const COVER = "cover";
const answered = (status) => Object.assign(new Error(`answered with ${status}`), { status });

// Every adapter's verdict on a failed creation, whichever way it keeps the
// record: a refusal is the API's judgement of the input, anything else leaves
// the outcome unknown.
const verdicts = [
  { status: 400, verdict: "drops" },
  { status: 404, verdict: "drops" },
  { status: 409, verdict: "drops" },
  { status: 422, verdict: "drops" },
  { status: 500, verdict: "replays" },
  { status: 503, verdict: "replays" },
  { status: 0, verdict: "replays" },
  { status: undefined, verdict: "replays" },
];

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

// The two adapters differ only in what becomes of the record: the film save
// serialises it into site storage, the still save lets it go with the editor.
function keeper({ durable }) {
  let record = null;
  const commit = durable ? (next) => { record = JSON.parse(JSON.stringify(next)); } : () => {};
  return {
    get record() { return record; },
    open: ({ created = false } = {}) => openSaveJournal({ name: "film save", created, record, commit }),
  };
}

describe.each([
  { kept: "serialised", durable: true },
  { kept: "held in memory", durable: false },
])("a save journal whose record is $kept", ({ durable }) => {
  it.each(verdicts)("$verdict a creation the API answered with $status", async ({ status, verdict }) => {
    const send = vi.fn().mockRejectedValueOnce(answered(status)).mockImplementation(async (input) => input);
    const journal = keeper({ durable }).open();
    const bring = (input) => journal.attempt(() => journal.settle(DETAILS, input, { create: send, update: send }));

    await expect(bring({ year: null })).rejects.toThrow("answered");
    await bring({ year: 2024 });

    expect(send.mock.calls[1][0]).toEqual(verdict === "drops" ? { year: 2024 } : { year: null });
  });

  it("takes the submitted input as the baseline, so an unchanged retry sends nothing further", async () => {
    const journal = keeper({ durable }).open();
    const input = { year: 2024 };
    const create = vi.fn().mockRejectedValueOnce(answered(undefined)).mockResolvedValue({ year: 1999 });
    const update = vi.fn().mockResolvedValue({});
    const bring = () => journal.attempt(() => journal.settle(DETAILS, input, { create, update }));

    await expect(bring()).rejects.toThrow();
    const settled = await bring();

    expect(create).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    // A replay answers with the record as it now stands, not as it was sent.
    expect(settled).toEqual({ year: 1999 });
  });

  it("sends a step again once its input has moved on, and remembers the answer while it has not", async () => {
    const journal = keeper({ durable }).open({ created: true });
    const update = vi.fn().mockImplementation(async (input) => ({ ...input, saved: true }));
    const bring = (input) => journal.attempt(() => journal.settle(DETAILS, input, { update }));

    const first = await bring({ year: 2024 });
    const again = await bring({ year: 2024 });
    await bring({ year: 1999 });

    expect(again).toEqual(first);
    expect(update.mock.calls.map(([input]) => input.year)).toEqual([2024, 1999]);
  });

  it("keeps one upload identity for content whose outcome is unknown, and mints another for a replacement", async () => {
    const journal = keeper({ durable }).open({ created: true });
    const send = vi.fn().mockRejectedValueOnce(answered(0)).mockImplementation(async ({ uploadId }) => `key/${uploadId}`);
    const attempt = (identity) => journal.attempt(() => {
      journal.select(COVER, { identity, name: "cover.png", body: "bytes" });
      return journal.upload(COVER, send);
    });

    await expect(attempt("first")).rejects.toThrow();
    const key = await attempt("first");
    const replaced = await attempt("second");
    // The acknowledged key is the journal's answer; nothing is uploaded twice.
    expect(await attempt("second")).toBe(replaced);

    const identities = send.mock.calls.map(([upload]) => upload.uploadId);
    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).not.toBe(identities[1]);
    expect(key).toBe(`key/${identities[1]}`);
    expect(replaced).toBe(`key/${identities[2]}`);
  });

  it("refuses an object key an upload never returned", async () => {
    const journal = keeper({ durable }).open({ created: true });
    await expect(journal.attempt(() => {
      journal.select(COVER, { identity: "first", name: "cover.png", body: "bytes" });
      return journal.upload(COVER, async () => "");
    })).rejects.toThrow("Upload returned no object key");
  });

  it("names the step that was outstanding, and forgets it when the next attempt begins", async () => {
    const journal = keeper({ durable }).open({ created: true });
    const bring = (update) => journal.attempt(() => journal.settle(COVER, "key", { update }));

    await expect(bring(async () => { throw answered(0); })).rejects.toThrow();
    expect(journal.progress().outstanding).toEqual({ step: COVER, kind: "update" });

    await bring(async () => ({}));
    expect(journal.progress()).toMatchObject({ saving: false, outstanding: null, acknowledged: [COVER] });
  });

  it("runs one attempt at a time, so a double submit cannot bring a second record into being", async () => {
    const journal = keeper({ durable }).open();
    let finish;
    const create = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = () => resolve({}); }));
    const bring = () => journal.attempt(() => journal.settle(DETAILS, { year: 2024 }, { create }));

    const pending = bring();
    await expect(bring()).rejects.toThrow("A film save is already in progress.");
    expect(journal.progress().saving).toBe(true);
    finish();
    await pending;

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("has nothing to create until input is offered for it", async () => {
    const journal = keeper({ durable }).open();
    const create = vi.fn();
    await journal.attempt(() => journal.settle(DETAILS, null, { create }));
    expect(create).not.toHaveBeenCalled();
  });
});

describe("a save journal read back from where its keeper put it", () => {
  it("commits the record before it sends, so nothing is attempted off the record", async () => {
    const seen = [];
    const journal = openSaveJournal({
      name: "film save",
      commit: (record) => seen.push(JSON.parse(JSON.stringify(record))),
    });

    await journal.attempt(() => journal.settle(DETAILS, { year: 2024 }, {
      create: async () => {
        expect(seen.at(-1).steps[DETAILS].pinned).toEqual({ year: 2024 });
        return {};
      },
    }));

    expect(seen.at(-1).created).toBe(true);
  });

  it("sends nothing when the keeper cannot store the record", async () => {
    const journal = openSaveJournal({
      name: "film save",
      commit: () => { throw new Error("no room"); },
    });
    const create = vi.fn();

    await expect(journal.attempt(() => journal.settle(DETAILS, { year: 2024 }, { create })))
      .rejects.toThrow("no room");
    expect(create).not.toHaveBeenCalled();
  });

  it("carries a dropped refusal over to the next session, so the retry cannot repeat it", async () => {
    const kept = keeper({ durable: true });
    const first = kept.open();
    const refuse = vi.fn().mockRejectedValue(answered(400));

    await expect(first.attempt(() => first.settle(DETAILS, { year: null }, { create: refuse })))
      .rejects.toThrow();
    const send = vi.fn().mockImplementation(async (input) => input);
    const resumed = kept.open();
    await resumed.attempt(() => resumed.settle(DETAILS, { year: 2024 }, { create: send }));

    expect(send).toHaveBeenCalledWith({ year: 2024 });
  });

  it("asks for content again when the record outlived the bytes", async () => {
    const kept = keeper({ durable: true });
    const first = kept.open({ created: true });
    const send = vi.fn().mockRejectedValue(answered(0));

    await expect(first.attempt(() => {
      first.select(COVER, { identity: "content", name: "cover.png", body: "bytes" });
      return first.upload(COVER, send);
    })).rejects.toThrow();
    expect(first.progress().awaiting).toEqual([]);

    const resumed = kept.open({ created: true });
    expect(resumed.progress().awaiting).toEqual([{ step: COVER, name: "cover.png" }]);
    // The identity outlives the bytes, so reselecting the same content finishes
    // the upload it began rather than leaving a second object behind.
    resumed.select(COVER, { identity: "content", name: "cover.png", body: "bytes" });
    expect(resumed.progress().awaiting).toEqual([]);
    await resumed.attempt(() => resumed.upload(COVER, async ({ uploadId }) => `key/${uploadId}`));
    expect(send.mock.calls[0][0].uploadId).toBe(
      (await resumed.attempt(() => resumed.upload(COVER, send))).split("/")[1]
    );
  });

  it.each([
    ["a record of another shape", { steps: {} }],
    ["a step of another shape", { created: false, steps: { details: "pinned" } }],
    ["an upload identity it never allocated", { created: true, steps: { cover: { upload: { identity: 1 } } } }],
  ])("refuses %s", (_reason, record) => {
    expect(() => openSaveJournal({ name: "film save", record })).toThrow("Invalid save-journal");
  });
});
