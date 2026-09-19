import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";

/*
 * Characterization of the AI formatter route, POST /api/script-scenes/format,
 * with no OpenAI key: request validation and the disabled response. Tests
 * never reach OpenAI (see helpers/guard.js).
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const PATH = "/api/script-scenes/format";
const PAGE_IMAGE = { page: 1, dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const INVALID_TEXT = "Invalid body. Expected capturedText to be a non-empty string.";
const TOO_LONG = "The selection is too long to format. Capture a shorter range.";
const INVALID_IMAGE = "Invalid page image. Expected { page:int, dataUrl:base64 image }.";
const DISABLED = "AI formatting isn't available right now.";

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

function format(body, options = {}) {
    return api.post(PATH, { cookie, body, ...options });
}

describe("the AI formatter", () => {
    test("requires the sign-in cookie before it reads the body", async () => {
        await expectError(api.post(PATH, { body: { capturedText: "INT. DINER" } }), 401, "Sign in to make changes.");
        await expectError(api.post(PATH, { rawBody: "{not json" }), 401, "Sign in to make changes.");
    });

    test("requires non-blank captured text", async () => {
        for (const body of [{}, { capturedText: "" }, { capturedText: "   " }, { capturedText: 5 }]) {
            await expectError(format(body), 400, INVALID_TEXT);
        }
        await expectError(api.post(PATH, { cookie }), 400, INVALID_TEXT);
    });

    test("refuses captured text or a draft over 60,000 characters with a 413", async () => {
        await expectError(format({ capturedText: "x".repeat(60001) }), 413, TOO_LONG);
        await expectError(format({ capturedText: "INT. DINER", draftMarkdown: "x".repeat(60001) }), 413, TOO_LONG);
    });

    test("accepts at most 6 page images", async () => {
        const pageImages = Array.from({ length: 7 }, (_, index) => ({ ...PAGE_IMAGE, page: index + 1 }));
        await expectError(format({ capturedText: "INT. DINER", pageImages }), 400, "At most 6 page images can be sent.");
    });

    test("requires each page image to have a whole page number and a base64 PNG, JPEG or WebP data URL", async () => {
        const invalid = [
            { dataUrl: PAGE_IMAGE.dataUrl },
            { page: 1.5, dataUrl: PAGE_IMAGE.dataUrl },
            { page: 1, dataUrl: 5 },
            { page: 1, dataUrl: "data:image/gif;base64,R0lGOD" },
            { page: 1, dataUrl: "data:image/png;base64,***" },
            { page: 1, dataUrl: `data:image/png;base64,${"A".repeat(3_000_000)}` },
        ];
        for (const image of invalid) {
            await expectError(format({ capturedText: "INT. DINER", pageImages: [image] }), 400, INVALID_IMAGE);
        }
    });

    test("answers 503 for a valid request when no OpenAI key is set", async (t) => {
        t.mock.method(console, "error", () => {});
        const valid = [
            { capturedText: "INT. DINER - NIGHT" },
            { capturedText: "x".repeat(60000), draftMarkdown: "x".repeat(60000) },
            {
                capturedText: "INT. DINER - NIGHT",
                draftMarkdown: "## INT. DINER - NIGHT",
                pageStart: 2,
                pageEnd: "three",
                pageImages: Array.from({ length: 6 }, (_, index) => ({ ...PAGE_IMAGE, page: index + 1 })),
                omittedPageCount: -1,
            },
            { capturedText: "INT. DINER - NIGHT", pageImages: "not a list" },
        ];
        for (const body of valid) {
            await expectError(format(body), 503, DISABLED);
        }
    });

    test("always sends and reports gpt-5-nano without a temperature", async (t) => {
        const previousKey = process.env.OPENAI_API_KEY;
        const previousModel = process.env.OPENAI_SCREENPLAY_MODEL;
        process.env.OPENAI_API_KEY = "test-only-key";
        process.env.OPENAI_SCREENPLAY_MODEL = "gpt-4-legacy-value-that-must-be-ignored";
        let sent;
        const requestFetch = globalThis.fetch;
        t.mock.method(globalThis, "fetch", async (url, init) => {
            if (!String(url).includes("api.openai.com")) return requestFetch(url, init);
            sent = JSON.parse(init.body);
            return new Response(
                JSON.stringify({ output: [{ content: [{ type: "output_text", text: "## INT. DINER - NIGHT" }] }] }),
                { status: 200, headers: { "content-type": "application/json" } }
            );
        });
        try {
            const response = await format({ capturedText: "INT. DINER - NIGHT" });
            assert.equal(response.status, 200, response.text);
            assert.deepEqual(response.body, { markdown: "## INT. DINER - NIGHT", model: "gpt-5-nano" });
            assert.equal(sent.model, "gpt-5-nano");
            assert.ok(!("temperature" in sent));
        } finally {
            if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = previousKey;
            if (previousModel === undefined) delete process.env.OPENAI_SCREENPLAY_MODEL;
            else process.env.OPENAI_SCREENPLAY_MODEL = previousModel;
        }
    });

    test("parses its own body up to 12mb, above the app-wide 2mb limit", async (t) => {
        t.mock.method(console, "error", () => {});
        t.mock.method(console, "warn", () => {});
        const largeImage = { page: 1, dataUrl: `data:image/png;base64,${"A".repeat(2_900_000)}` };
        await expectError(format({ capturedText: "INT. DINER", pageImages: [largeImage] }), 503, DISABLED);

        const tooLarge = Array.from({ length: 5 }, (_, index) => ({ page: index + 1, dataUrl: largeImage.dataUrl }));
        await expectError(
            format({ capturedText: "INT. DINER", pageImages: tooLarge }),
            413,
            "The request is too large. Try a smaller selection or file."
        );
    });

    test("a signed-in request whose body isn't JSON gets the fixed 400", async (t) => {
        t.mock.method(console, "warn", () => {});
        await expectError(api.post(PATH, { cookie, rawBody: "{not json" }), 400, "The request could not be read.");
    });
});
