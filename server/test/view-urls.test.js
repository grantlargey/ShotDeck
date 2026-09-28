import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createPresignedGetUrl, signViewUrl } from "../src/s3.js";
import { signedUrlExpiry } from "./helpers/fixtures.js";

/*
 * The lifetime of a signed view URL: when it is signed, how long it lasts, when a
 * key is signed again, and what a record carries when its key can't be signed.
 * Presigning is local, so nothing here reaches S3.
 *
 * The clock is faked, because the whole scheme turns on where the moment of a
 * call falls in a fixed window. The URLs are really signed, and each case uses
 * its own key: the window's cache outlives one test.
 */

const WINDOW_MS = 60 * 60 * 1000;
const LIFETIME_MS = 2 * WINDOW_MS;
// A whole hour, so the start of its window is the moment itself.
const WINDOW_START = Date.UTC(2026, 8, 27, 10, 0, 0);

describe("the lifetime of a view URL", () => {
    test("signs from the start of the window and says when the URL dies", async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: WINDOW_START + 17 * 60 * 1000 });
        const { url, expiresAt } = await createPresignedGetUrl({ key: "covers/m/window.jpg" });

        const query = new URL(url).searchParams;
        assert.equal(query.get("X-Amz-Date"), "20260927T100000Z");
        assert.equal(query.get("X-Amz-Expires"), String(LIFETIME_MS / 1000));
        assert.equal(expiresAt.getTime(), WINDOW_START + LIFETIME_MS);
        // Whoever holds the URL must be able to trust the expiry it came with.
        assert.equal(expiresAt.getTime(), signedUrlExpiry(url));
    });

    test("hands out one URL for a whole window, never one with less than a window left", async (t) => {
        const key = "annotations/m/held.png";
        t.mock.timers.enable({ apis: ["Date"], now: WINDOW_START });
        const first = await createPresignedGetUrl({ key });

        for (const offset of [1_000, 30 * 60 * 1000, WINDOW_MS - 1]) {
            t.mock.timers.setTime(WINDOW_START + offset);
            const again = await createPresignedGetUrl({ key });
            assert.equal(again.url, first.url);
            assert.equal(again.expiresAt.getTime(), first.expiresAt.getTime());
            // The margin a browser leaves itself relies on this.
            assert.ok(again.expiresAt.getTime() - Date.now() >= WINDOW_MS, `only ${again.expiresAt - Date.now()}ms left`);
        }
    });

    test("a URL past its expiry is re-signed, for longer than it takes to use", async (t) => {
        const key = "annotations/m/expired.png";
        t.mock.timers.enable({ apis: ["Date"], now: WINDOW_START });
        const original = await createPresignedGetUrl({ key });

        t.mock.timers.setTime(original.expiresAt.getTime() + 60_000);
        const replacement = await createPresignedGetUrl({ key });
        assert.ok(original.expiresAt.getTime() < Date.now());
        assert.notEqual(replacement.url, original.url);
        assert.ok(replacement.expiresAt.getTime() - Date.now() >= WINDOW_MS);
    });

    test("a record carries no URL and no expiry when it holds no key", async () => {
        for (const key of [null, undefined, ""]) {
            assert.deepEqual(await signViewUrl(key), { url: null, expiresAt: null });
        }
    });

    test("a key that can't be signed leaves the record's URL null instead of failing the request", async (t) => {
        t.mock.method(console, "error", () => {});
        // Every signing failure reads the same from here; a key the signer can't
        // encode is the one a test can cause.
        assert.deepEqual(await signViewUrl(5), { url: null, expiresAt: null });
        assert.equal(console.error.mock.callCount(), 1);
    });
});
