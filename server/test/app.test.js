import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALLOWED_ORIGIN, startApi } from "./helpers/api.js";

const api = await startApi();

describe("app-wide behavior", () => {
    test("GET /health answers ok", async () => {
        const response = await api.get("/health");
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { ok: true });
    });

    test("a body that isn't JSON gets a fixed 400, before the sign-in check", async (t) => {
        t.mock.method(console, "warn", () => {});
        const response = await api.post("/movies", { rawBody: "{not json" });
        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { error: "The request could not be read." });
    });

    test("a JSON body over 2mb gets a fixed 413, before the sign-in check", async (t) => {
        t.mock.method(console, "warn", () => {});
        const response = await api.post("/movies", { body: { title: "x".repeat(2.1 * 1024 * 1024) } });
        assert.equal(response.status, 413);
        assert.deepEqual(response.body, { error: "The request is too large. Try a smaller selection or file." });
    });

    test("an unexpected error is a generic 500, such as an id that isn't a UUID", async (t) => {
        t.mock.method(console, "error", () => {});
        const response = await api.get("/movies/not-a-uuid");
        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { error: "Something went wrong on the server." });
    });

    test("CORS allows the local client origins, with credentials", async () => {
        for (const origin of [ALLOWED_ORIGIN, "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]) {
            const response = await api.get("/health", { origin });
            assert.equal(response.headers.get("access-control-allow-origin"), origin);
            assert.equal(response.headers.get("access-control-allow-credentials"), "true");
        }
    });

    test("CORS gives any other origin no allow-origin header, but still answers reads", async () => {
        const response = await api.get("/health", { origin: "https://elsewhere.example" });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
});
