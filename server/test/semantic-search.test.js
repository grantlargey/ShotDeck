import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { pool } from "../src/db.js";
import {
    batchEmbeddingWork,
    cosineSimilarity,
    indexScenes,
    queueAllSceneEmbeddings,
    sceneEmbeddingInput,
    sceneEmbeddingsSettled,
} from "../src/services/semantic-search.service.js";
import { signInOwner, startApi } from "./helpers/api.js";
import { createFilmWithScript, createScene, scenesPath, TAGS } from "./helpers/fixtures.js";

/*
 * Characterization of semantic scene search. No test reaches Gemini: the
 * helpers/guard.js fetch wrapper still refuses every non-local host, and the
 * tests that need embeddings replace fetch with a deterministic stand-in.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const SEARCH_PATH = "/script-scenes/semantic";
const DISABLED = "Semantic search isn't available right now.";
const TOPICS = ["diner", "alley", "space", "quiet"];

/** A tiny deterministic "embedding": one axis per topic word in the input. */
function vectorFor(input) {
    const text = String(input).toLowerCase();
    return TOPICS.map((topic) => (text.includes(topic) ? 1 : 0));
}

/** Sets a test-only key for one test and restores the environment afterwards. */
function useKey(t) {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-only-key";
    t.after(() => {
        if (previous === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previous;
    });
}

/**
 * Replaces fetch for Gemini calls only; the API client's own requests still go
 * to the real server. Returns the parsed request bodies that were sent. Also
 * quiets the background indexer's progress lines.
 */
function mockEmbeddings(t, reply = (inputs) => inputs.map(vectorFor)) {
    const requests = [];
    const requestFetch = globalThis.fetch;
    t.mock.method(console, "log", () => {});
    t.mock.method(globalThis, "fetch", async (url, init) => {
        if (!String(url).includes("generativelanguage.googleapis.com")) return requestFetch(url, init);
        const body = JSON.parse(init.body);
        requests.push({ url: String(url), method: init.method, headers: init.headers, body });
        const inputs = body.requests.map((request) => request.content.parts[0].text);
        const vectors = await reply(inputs);
        return new Response(
            JSON.stringify({ embeddings: vectors.map((values) => ({ values })) }),
            { status: 200, headers: { "content-type": "application/json" } }
        );
    });
    return requests;
}

function search(params) {
    return api.get(`${SEARCH_PATH}?${new URLSearchParams(params).toString()}`);
}

async function hasEmbedding(sceneId) {
    const result = await pool.query("SELECT 1 FROM scene_embeddings WHERE scene_id = $1", [sceneId]);
    return result.rowCount === 1;
}

let place;
let diner;
let alley;
// Saved while no key was set, so only the start-up pass embeds it.
let unembedded;

before(async () => {
    place = await createFilmWithScript(api, cookie, { title: "Semantic Diner" });
    diner = await createScene(api, cookie, place, {
        start_time_seconds: 0,
        end_time_seconds: 10,
        scene_text: "## INT. NIGHT DINER - NIGHT\n\nMara pours the coffee and waits.",
        tags: [TAGS.protagonist],
    });
    alley = await createScene(api, cookie, place, {
        start_time_seconds: 20,
        end_time_seconds: 30,
        scene_text: "## EXT. ALLEY - NIGHT\n\nShe runs through the rain.",
        tags: [TAGS.revelation],
    });
});

describe("semantic search request contract", () => {
    test("requires a non-blank query and a whole limit in range", async () => {
        for (const query of [{}, { q: "" }, { q: "   " }]) {
            const response = await search(query);
            assert.equal(response.status, 400, response.text);
            assert.deepEqual(response.body, { error: "Invalid query. q must be a non-empty string." });
        }

        for (const limit of ["0", "51", "1.5", "many", ""]) {
            const response = await search({ q: "a tense scene", limit });
            assert.equal(response.status, 400, response.text);
            assert.deepEqual(response.body, {
                error: "Invalid limit. limit must be a whole number from 1 to 50.",
            });
        }
    });

    test("refuses a description over 500 characters", async () => {
        const response = await search({ q: "x".repeat(501) });
        assert.equal(response.status, 413, response.text);
        assert.deepEqual(response.body, { error: "That description is too long. Keep it under 500 characters." });
    });

    test("answers 503 for a valid search when no Gemini key is set", async (t) => {
        t.mock.method(console, "error", () => {});
        const response = await search({ q: "a tense scene", limit: "5" });
        assert.equal(response.status, 503, response.text);
        assert.deepEqual(response.body, { error: DISABLED });
    });

    test("reports an unconfigured index without contacting Gemini", async () => {
        const response = await api.get(`${SEARCH_PATH}/status`);
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.configured, false);
        assert.equal(response.body.model, "gemini-embedding-001");
        assert.equal(response.body.indexed_count + response.body.pending_count, response.body.total_count);
        assert.ok(response.body.pending_count >= 2);
    });

    test("saves a scene without embedding it when no Gemini key is set", async () => {
        unembedded = await createScene(api, cookie, place, {
            start_time_seconds: 60,
            end_time_seconds: 70,
            scene_text: "## INT. STAIRWELL - NIGHT\n\nFootsteps echo below.",
        });
        await sceneEmbeddingsSettled();
        assert.equal(await hasEmbedding(unembedded.id), false);
    });
});

describe("scene embedding input", () => {
    test("uses human-readable tag labels so slugs do not anchor the meaning", () => {
        assert.equal(
            sceneEmbeddingInput({ scene_text: "## INT. DINER", tags: [TAGS.protagonist] }),
            "Tags: Protagonist\n\n## INT. DINER"
        );
        assert.equal(sceneEmbeddingInput({ scene_text: "x", tags: [] }), "Tags: none\n\nx");
        assert.equal(sceneEmbeddingInput({}), "Tags: none\n\n");
    });
});

describe("batchEmbeddingWork", () => {
    const item = (size) => ({ input: "x".repeat(size) });

    test("splits by request count and total characters, and keeps order", () => {
        const work = [item(10), item(10), item(10), item(10), item(10)];
        assert.deepEqual(
            batchEmbeddingWork(work, { maxItems: 2 }).map((batch) => batch.length),
            [2, 2, 1]
        );
        assert.deepEqual(
            batchEmbeddingWork(work, { maxChars: 25 }).map((batch) => batch.length),
            [2, 2, 1]
        );
        assert.deepEqual(batchEmbeddingWork([]), []);
    });

    test("keeps an oversized input on its own", () => {
        const work = [item(40), item(100), item(40)];
        assert.deepEqual(
            batchEmbeddingWork(work, { maxChars: 60 }).map((batch) => batch.map((entry) => entry.input.length)),
            [[40], [100], [40]]
        );
    });
});

describe("cosineSimilarity", () => {
    test("scores identical, orthogonal and unusable vectors", () => {
        assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
        assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
        assert.equal(cosineSimilarity([1, 1], [1, 1]), 1);
        assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
        assert.equal(cosineSimilarity([1, 0], [1]), 0);
        assert.equal(cosineSimilarity([1, Number.NaN], [1, 1]), 0);
        assert.equal(cosineSimilarity(null, [1]), 0);
    });
});

describe("semantic search with a Gemini key", () => {
    test("embeds scene text and tags, then ranks the closest scene first", async (t) => {
        useKey(t);
        const requests = mockEmbeddings(t);

        const indexed = await indexScenes(pool, { sceneIds: [diner.id, alley.id] });
        assert.deepEqual(
            { indexed: indexed.indexed_count, current: indexed.current_count, total: indexed.total_count },
            { indexed: 2, current: 0, total: 2 }
        );
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
        assert.equal(requests[0].method, "POST");
        assert.equal(requests[0].headers["x-goog-api-key"], "test-only-key");
        assert.equal(requests[0].body.requests.length, 2);
        for (const item of requests[0].body.requests) {
            assert.equal(item.model, "models/gemini-embedding-001");
            assert.equal(item.taskType, "RETRIEVAL_DOCUMENT");
            assert.equal(item.outputDimensionality, 768);
        }
        assert.deepEqual(
            new Set(requests[0].body.requests.map((item) => item.content.parts[0].text)),
            new Set([sceneEmbeddingInput(diner), sceneEmbeddingInput(alley)])
        );

        const dinerResponse = await search({ q: "a tense conversation in a diner", limit: "1" });
        assert.equal(dinerResponse.status, 200, dinerResponse.text);
        assert.equal(dinerResponse.body.model, "gemini-embedding-001");
        assert.equal(dinerResponse.body.scenes.length, 1);
        assert.equal(dinerResponse.body.scenes[0].id, diner.id);
        assert.equal(dinerResponse.body.scenes[0].similarity, 1);
        assert.equal(dinerResponse.body.scenes[0].movie_title, "Semantic Diner");
        // The query uses the retrieval-query task, unlike the indexed documents.
        const queryRequest = requests[1].body.requests[0];
        assert.equal(queryRequest.taskType, "RETRIEVAL_QUERY");
        assert.equal(queryRequest.content.parts[0].text, "a tense conversation in a diner");
        assert.equal(queryRequest.outputDimensionality, 768);
        // The same record as tag search, plus the score.
        const { similarity, ...scene } = dinerResponse.body.scenes[0];
        assert.equal(similarity, 1);
        assert.deepEqual(scene, { ...diner, movie_title: "Semantic Diner" });

        const alleyResponse = await search({ q: "she runs through the alley at night", limit: "1" });
        assert.equal(alleyResponse.body.scenes[0].id, alley.id);
        assert.equal(alleyResponse.body.scenes[0].similarity, 1);
    });

    test("combines tag filters with semantic ranking", async (t) => {
        useKey(t);
        mockEmbeddings(t);
        const onlyRevelation = await search({
            q: "from the diner out into the alley",
            tags: TAGS.revelation,
            limit: "50",
        });
        assert.equal(onlyRevelation.status, 200, onlyRevelation.text);
        assert.deepEqual(
            onlyRevelation.body.scenes.map((row) => row.id),
            [alley.id]
        );

        const eitherTag = await search({
            q: "from the diner out into the alley",
            tags: `${TAGS.protagonist},${TAGS.revelation}`,
            match: "any",
            limit: "50",
        });
        assert.deepEqual(
            new Set(eitherTag.body.scenes.map((row) => row.id)),
            new Set([diner.id, alley.id])
        );
    });

    test("respects the requested result limit", async (t) => {
        useKey(t);
        mockEmbeddings(t);
        const one = await search({ q: "from the diner out into the alley", limit: "1" });
        assert.equal(one.body.scenes.length, 1);
        const many = await search({ q: "from the diner out into the alley", limit: "50" });
        assert.deepEqual(
            new Set(many.body.scenes.map((row) => row.id)),
            new Set([diner.id, alley.id])
        );
    });

    test("leaves out scenes scoring below 0.55", async (t) => {
        useKey(t);
        // "Somewhere between" scores 0.56 against the diner scene and 0.54 against
        // the alley; the banana bread recipe is unlike every scene.
        mockEmbeddings(t, (inputs) =>
            inputs.map((input) =>
                input.includes("banana") ? [0, 0, 1, 0] : [0.56, 0.54, Math.sqrt(1 - 0.56 ** 2 - 0.54 ** 2), 0]
            )
        );
        const response = await search({ q: "somewhere between", limit: "50" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            response.body.scenes.map((row) => row.id),
            [diner.id]
        );
        assert.ok(Math.abs(response.body.scenes[0].similarity - 0.56) < 1e-6);

        const unrelated = await search({ q: "a recipe for banana bread", limit: "50" });
        assert.equal(unrelated.status, 200, unrelated.text);
        assert.deepEqual(unrelated.body.scenes, []);
    });

    test("re-embeds a saved scene in the background only when its text changes", async (t) => {
        useKey(t);
        const requests = mockEmbeddings(t);
        const save = (sceneText) =>
            api.put(`${scenesPath(place)}/${diner.id}`, {
                cookie,
                body: {
                    script_key: place.script.s3_key,
                    start_time_seconds: diner.start_time_seconds,
                    end_time_seconds: diner.end_time_seconds,
                    script_location: diner.script_location,
                    scene_text: sceneText,
                    tags: diner.tags,
                },
            });

        const unchanged = await save(diner.scene_text);
        assert.equal(unchanged.status, 200, unchanged.text);
        await sceneEmbeddingsSettled();
        assert.equal(requests.length, 0);

        const changedText = "## INT. NIGHT DINER - NIGHT\n\nMara wipes down an empty counter.";
        const updated = await save(changedText);
        assert.equal(updated.status, 200, updated.text);
        await sceneEmbeddingsSettled();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.requests.length, 1);
        assert.equal(requests[0].body.requests[0].taskType, "RETRIEVAL_DOCUMENT");
        assert.ok(requests[0].body.requests[0].content.parts[0].text.includes(changedText));

        const current = await indexScenes(pool, { sceneIds: [diner.id] });
        assert.equal(current.indexed_count, 0);
    });

    test("embeds a newly captured scene without holding up the save", async (t) => {
        useKey(t);
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const requests = mockEmbeddings(t, async (inputs) => {
            await gate;
            return inputs.map(vectorFor);
        });

        // Gemini hasn't answered, yet the save is already done.
        const quiet = await createScene(api, cookie, place, {
            start_time_seconds: 40,
            end_time_seconds: 50,
            scene_text: "## INT. QUIET SPACE - DAY\n\nThe room is empty.",
            tags: [TAGS.selfConflict],
        });
        assert.equal(await hasEmbedding(quiet.id), false);

        release();
        await sceneEmbeddingsSettled();
        assert.equal(await hasEmbedding(quiet.id), true);
        assert.deepEqual(
            requests.flatMap((request) => request.body.requests.map((item) => item.content.parts[0].text)),
            [sceneEmbeddingInput(quiet)]
        );

        const response = await search({ q: "somewhere quiet", limit: "1" });
        assert.equal(response.body.scenes[0].id, quiet.id);
    });

    test("keeps a scene saved when its embedding fails", async (t) => {
        useKey(t);
        const errors = t.mock.method(console, "error", () => {});
        const requestFetch = globalThis.fetch;
        t.mock.method(globalThis, "fetch", async (url, init) => {
            if (!String(url).includes("generativelanguage.googleapis.com")) return requestFetch(url, init);
            return new Response("upstream down", { status: 500 });
        });

        const scene = await createScene(api, cookie, place, {
            start_time_seconds: 80,
            end_time_seconds: 90,
            scene_text: "## EXT. ROOFTOP - DAWN\n\nWind over the city.",
        });
        await sceneEmbeddingsSettled();
        assert.equal(await hasEmbedding(scene.id), false);
        assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).startsWith("Failed to embed")));
    });

    test("embeds every missing or stale scene when the API starts, once", async (t) => {
        useKey(t);
        const requests = mockEmbeddings(t);

        await queueAllSceneEmbeddings(pool);
        await sceneEmbeddingsSettled();
        assert.ok(requests.length >= 1);
        assert.equal(await hasEmbedding(unembedded.id), true);

        const status = await api.get(`${SEARCH_PATH}/status`);
        assert.equal(status.status, 200, status.text);
        assert.equal(status.body.configured, true);
        assert.equal(status.body.pending_count, 0);
        assert.equal(status.body.indexed_count, status.body.total_count);

        const sent = requests.length;
        await queueAllSceneEmbeddings(pool);
        await sceneEmbeddingsSettled();
        assert.equal(requests.length, sent);
    });

    test("reports an upstream failure as a 502", async (t) => {
        useKey(t);
        t.mock.method(console, "error", () => {});
        const requestFetch = globalThis.fetch;
        t.mock.method(globalThis, "fetch", async (url, init) => {
            if (!String(url).includes("generativelanguage.googleapis.com")) return requestFetch(url, init);
            return new Response("upstream down", { status: 500 });
        });

        const response = await search({ q: "diner" });
        assert.equal(response.status, 502, response.text);
        assert.deepEqual(response.body, { error: "The semantic search request failed. Try again." });
    });

    test("rejects a malformed embedding vector", async (t) => {
        useKey(t);
        t.mock.method(console, "error", () => {});
        mockEmbeddings(t, (inputs) => inputs.map(() => []));

        const response = await search({ q: "diner" });
        assert.equal(response.status, 502, response.text);
        assert.deepEqual(response.body, { error: "The semantic search request failed. Try again." });
    });
});
