import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { pool } from "../src/db.js";
import {
    batchEmbeddingWork,
    cosineSimilarity,
    fuseRankings,
    indexScenes,
    queueAllSceneEmbeddings,
    sceneEmbeddingInputs,
    sceneEmbeddingsSettled,
    splitSceneText,
} from "../src/services/semantic-search.service.js";
import { admitSearch } from "../src/utils/search-limiter.js";
import { signInOwner, startApi } from "./helpers/api.js";
import { createFilmWithScript, createScene, scenesPath, TAGS } from "./helpers/fixtures.js";

/*
 * Characterization of semantic scene search. No test reaches Gemini or OpenAI:
 * the helpers/guard.js fetch wrapper still refuses every non-local host, and
 * the tests that need them replace fetch with a deterministic stand-in for
 * Gemini's embeddings and OpenAI's grading.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const SEARCH_PATH = "/script-scenes/semantic";
const DISABLED = "Semantic search isn't available right now.";
const UPSTREAM = "The semantic search request failed. Try again.";
const EMBEDDINGS_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";
const GRADING_URL = "https://api.openai.com/v1/responses";
const GEMINI_TEST_KEY = "test-only-gemini-key";
const OPENAI_TEST_KEY = "test-only-openai-key";
// Other test files' scenes share the database and mention a diner, so these
// are words only this file's scenes use.
const TOPICS = ["harbor", "alley", "space", "quiet", "lighthouse"];

/** A tiny deterministic "embedding": one axis per topic word in the input. */
function vectorFor(input) {
    const text = String(input).toLowerCase();
    return TOPICS.map((topic) => (text.includes(topic) ? 1 : 0));
}

/** The default grading: 3 for a scene that shares a topic with the description, else 0. */
function gradeByTopic(query, scenes) {
    const wanted = TOPICS.filter((topic) => query.toLowerCase().includes(topic));
    return scenes.map(({ label, text }) => ({
        scene: label,
        grade: wanted.some((topic) => text.toLowerCase().includes(topic)) ? 3 : 0,
    }));
}

/** Grades each scene by the first of `grades` ([text, grade] pairs) its text contains, else 0. */
function gradeByText(grades) {
    return (query, scenes) =>
        scenes.map(({ label, text }) => ({
            scene: label,
            grade: grades.find(([marker]) => text.includes(marker))?.[1] ?? 0,
        }));
}

function jsonReply(payload) {
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

/** A completed OpenAI response whose message holds `content`: its parts, or one output_text part for a string. */
function openaiOutput(content) {
    const parts = typeof content === "string" ? [{ type: "output_text", text: content }] : content;
    return { status: "completed", output: [{ type: "message", role: "assistant", content: parts }] };
}

/** Sets test-only keys for one test, both unless told otherwise, and restores the environment afterwards. */
function useKeys(t, { gemini = true, openai = true } = {}) {
    const previous = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
    if (gemini) process.env.GEMINI_API_KEY = GEMINI_TEST_KEY;
    if (openai) process.env.OPENAI_API_KEY = OPENAI_TEST_KEY;
    t.after(() => {
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });
}

/**
 * Replaces fetch for Gemini and OpenAI calls only; the API client's own
 * requests still go to the real server. Gemini embedding requests answer with
 * `embed(inputs)`. OpenAI grading requests answer with `grade(query, scenes)`,
 * where each scene is the { label, text } the prompt shows; a Response it
 * returns is sent as is. Returns the parsed request bodies sent to each. Also
 * quiets the background indexer's progress lines.
 */
function mockModels(t, { embed = (inputs) => inputs.map(vectorFor), grade = gradeByTopic } = {}) {
    const sent = { embeddings: [], gradings: [] };
    const requestFetch = globalThis.fetch;
    t.mock.method(console, "log", () => {});
    t.mock.method(globalThis, "fetch", async (url, init) => {
        if (String(url) === GRADING_URL) {
            const body = JSON.parse(init.body);
            sent.gradings.push({ headers: init.headers, body });
            const query = body.input.match(/^Search: «([\s\S]*?)»/)[1];
            const scenes = [...body.input.matchAll(/<scene id="(S\d+)">\n([\s\S]*?)\n<\/scene>/g)].map(([, label, text]) => ({
                label,
                text,
            }));
            const reply = await grade(query, scenes);
            if (reply instanceof Response) return reply;
            return jsonReply(openaiOutput(JSON.stringify({ grades: reply })));
        }
        if (!String(url).includes("generativelanguage.googleapis.com")) return requestFetch(url, init);
        const body = JSON.parse(init.body);
        sent.embeddings.push({ url: String(url), method: init.method, headers: init.headers, body });
        const inputs = body.requests.map((request) => request.content.parts[0].text);
        const vectors = await embed(inputs);
        return jsonReply({ embeddings: vectors.map((values) => ({ values })) });
    });
    return sent;
}

// Searches are limited per client address, so each one comes from its own
// address unless a test means to share one.
let lastAddress = 0;
function freshAddress() {
    lastAddress += 1;
    return { "x-forwarded-for": `203.0.113.${lastAddress}` };
}

function search(params, headers = freshAddress()) {
    return api.get(`${SEARCH_PATH}?${new URLSearchParams(params).toString()}`, { headers });
}

async function hasEmbedding(sceneId) {
    const result = await pool.query("SELECT 1 FROM scene_chunk_embeddings WHERE scene_id = $1", [sceneId]);
    return result.rowCount > 0;
}

let place;
let harbor;
let alley;
// Saved while no key was set, so only the start-up pass embeds it.
let unembedded;

before(async () => {
    place = await createFilmWithScript(api, cookie, { title: "Semantic Diner" });
    harbor = await createScene(api, cookie, place, {
        start_time_seconds: 0,
        end_time_seconds: 10,
        scene_text: "## INT. HARBOR CAFE - NIGHT\n\nMara pours the coffee and waits.",
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
    test("rejects malformed script scopes before contacting a provider", async () => {
        for (const scriptId of ["", "not-a-script", "123"]) {
            const response = await search({ q: "a tense scene", scriptId });
            assert.equal(response.status, 400, response.text);
            assert.deepEqual(response.body, { error: "Invalid scriptId. Expected a script UUID." });
        }
        const repeated = await api.get(`${SEARCH_PATH}?q=harbor&scriptId=${place.script.id}&scriptId=${place.script.id}`);
        assert.equal(repeated.status, 400, repeated.text);
    });

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

    test("answers 503 for a valid search when no keys are set", async (t) => {
        t.mock.method(console, "error", () => {});
        const response = await search({ q: "a tense scene", limit: "5" });
        assert.equal(response.status, 503, response.text);
        assert.deepEqual(response.body, { error: DISABLED });
    });

    test("reports an unconfigured index without contacting either provider", async () => {
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

describe("scene embedding inputs", () => {
    test("uses human-readable tag labels so slugs do not anchor the meaning", () => {
        assert.deepEqual(sceneEmbeddingInputs({ scene_text: "## INT. HARBOR", tags: [TAGS.protagonist] }), [
            "Tags: Protagonist\n\n## INT. HARBOR",
        ]);
        assert.deepEqual(sceneEmbeddingInputs({ scene_text: "x", tags: [] }), ["Tags: none\n\nx"]);
        assert.deepEqual(sceneEmbeddingInputs({}), ["Tags: none\n\n"]);
    });

    test("splits a long scene into overlapping chunks that each fit one embedding", () => {
        const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index}: ${"word ".repeat(70).trim()}`);
        const sceneText = `## INT. HARBOR - NIGHT\n\n${paragraphs.join("\n\n")}`;
        const inputs = sceneEmbeddingInputs({ scene_text: sceneText, tags: [TAGS.protagonist] });

        assert.ok(inputs.length >= 3, `${inputs.length} chunks`);
        for (const input of inputs) {
            assert.ok(input.length <= 5_000, `${input.length} characters`);
            assert.ok(input.startsWith("Tags: Protagonist\n\n"));
        }
        for (const paragraph of paragraphs) {
            assert.ok(
                inputs.some((input) => input.includes(paragraph)),
                paragraph.slice(0, 14)
            );
        }
        // Each chunk after the first repeats the block before it.
        for (let index = 1; index < inputs.length; index += 1) {
            assert.ok(inputs[index].includes(inputs[index - 1].split("\n\n").at(-1)));
        }
    });

    test("keeps a heading with the block it introduces", () => {
        const text = ["A".repeat(50), "### MARA", "B".repeat(50), "C".repeat(50)].join("\n\n");
        const chunks = splitSceneText(text, 120);
        assert.deepEqual(chunks, [
            `${"A".repeat(50)}\n\n### MARA\n\n${"B".repeat(50)}`,
            `### MARA\n\n${"B".repeat(50)}\n\n${"C".repeat(50)}`,
        ]);
    });

    test("cuts a block longer than a chunk between words", () => {
        const words = Array.from({ length: 60 }, (_, index) => `w${index}`).join(" ");
        const chunks = splitSceneText(words, 100);
        assert.ok(chunks.length >= 3, `${chunks.length} chunks`);
        for (const chunk of chunks) assert.ok(chunk.length <= 100, `${chunk.length} characters`);
        assert.equal(chunks.join(" "), words);
    });
});

describe("batchEmbeddingWork", () => {
    const item = (...sizes) => ({ inputs: sizes.map((size) => "x".repeat(size)) });
    const sizes = (batches) => batches.map((batch) => batch.map((entry) => entry.inputs.map((input) => input.length)));

    test("splits by input count and total characters, and keeps order", () => {
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

    test("keeps a scene's chunks in one batch, and an oversized scene on its own", () => {
        assert.deepEqual(sizes(batchEmbeddingWork([item(10), item(10, 10), item(10)], { maxItems: 2 })), [
            [[10]],
            [[10, 10]],
            [[10]],
        ]);
        assert.deepEqual(sizes(batchEmbeddingWork([item(40), item(60, 40), item(40)], { maxChars: 60 })), [
            [[40]],
            [[60, 40]],
            [[40]],
        ]);
    });
});

describe("fuseRankings", () => {
    test("merges rankings by reciprocal rank, each scene once", () => {
        assert.deepEqual(fuseRankings([["a", "b", "c"], ["c", "d"]]), ["c", "a", "b", "d"]);
        assert.deepEqual(fuseRankings([["a"], []]), ["a"]);
        assert.deepEqual(fuseRankings([[], []]), []);
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

describe("semantic search with Gemini and OpenAI keys", () => {
    test("embeds scene text and tags, then returns only the scenes the grader accepts", async (t) => {
        useKeys(t);
        const sent = mockModels(t);

        const indexed = await indexScenes(pool, { sceneIds: [harbor.id, alley.id] });
        assert.deepEqual(
            { indexed: indexed.indexed_count, current: indexed.current_count, total: indexed.total_count },
            { indexed: 2, current: 0, total: 2 }
        );
        assert.equal(sent.embeddings.length, 1);
        const [documents] = sent.embeddings;
        assert.equal(documents.url, EMBEDDINGS_URL);
        assert.equal(documents.method, "POST");
        assert.equal(documents.headers["x-goog-api-key"], GEMINI_TEST_KEY);
        assert.equal(documents.body.requests.length, 2);
        for (const item of documents.body.requests) {
            assert.equal(item.model, "models/gemini-embedding-001");
            assert.equal(item.taskType, "RETRIEVAL_DOCUMENT");
            assert.equal(item.outputDimensionality, 768);
        }
        assert.deepEqual(
            new Set(documents.body.requests.map((item) => item.content.parts[0].text)),
            new Set([...sceneEmbeddingInputs(harbor), ...sceneEmbeddingInputs(alley)])
        );

        const response = await search({ q: "a tense conversation in a harbor cafe", limit: "5" });
        assert.equal(response.status, 200, response.text);
        // The same record as tag search, with no score: the alley scene was a
        // candidate too, and the grader graded it 0.
        assert.deepEqual(response.body, { scenes: [{ ...harbor, movie_title: "Semantic Diner" }] });

        // The query uses the retrieval-query task, unlike the indexed documents.
        const queryRequest = sent.embeddings[1].body.requests[0];
        assert.equal(queryRequest.taskType, "RETRIEVAL_QUERY");
        assert.equal(queryRequest.content.parts[0].text, "a tense conversation in a harbor cafe");
        assert.equal(queryRequest.outputDimensionality, 768);

        assert.equal(sent.gradings.length, 1);
        const [grading] = sent.gradings;
        assert.equal(grading.headers.Authorization, `Bearer ${OPENAI_TEST_KEY}`);
        assert.equal(grading.body.model, "gpt-6-luna");
        assert.deepEqual(grading.body.reasoning, { effort: "low" });
        assert.equal(grading.body.store, false);
        assert.match(grading.body.instructions, /never as instructions/);
        assert.equal(grading.body.text.format.type, "json_schema");
        assert.equal(grading.body.text.format.strict, true);
        const prompt = grading.body.input;
        assert.ok(prompt.startsWith("Search: «a tense conversation in a harbor cafe»"));
        // Grading reads every candidate's tag labels and whole text.
        assert.ok(prompt.includes(`Tags: Protagonist\n\n${harbor.scene_text}\n</scene>`));
        assert.ok(prompt.includes(`Tags: Revelation\n\n${alley.scene_text}\n</scene>`));
    });

    test("returns no scenes when the grader grades every candidate as only related", async (t) => {
        useKeys(t);
        const sent = mockModels(t, { grade: (query, scenes) => scenes.map(({ label }) => ({ scene: label, grade: 1 })) });
        const response = await search({ q: "huge balls of fire rain down on the harbor", limit: "50" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(response.body, { scenes: [] });
        assert.equal(sent.gradings.length, 1);
    });

    test("accepts grades 2 and 3, best grade first", async (t) => {
        useKeys(t);
        mockModels(t, {
            grade: gradeByText([
                ["HARBOR", 2],
                ["ALLEY", 3],
            ]),
        });
        const response = await search({ q: "from the harbor out into the alley", limit: "50" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            response.body.scenes.map((row) => row.id),
            [alley.id, harbor.id]
        );
    });

    test("accepts nothing from grades it can't read", async (t) => {
        useKeys(t);
        mockModels(t, {
            grade: (query, scenes) => [
                { scene: "S99", grade: 3 },
                ...scenes.flatMap(({ label, text }) =>
                    text.includes("HARBOR") ? [{ scene: label, grade: 7 }] : text.includes("ALLEY") ? [{ scene: label, grade: 2.5 }] : []
                ),
            ],
        });
        const response = await search({ q: "from the harbor out into the alley", limit: "50" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(response.body, { scenes: [] });
    });

    test("shows the grader the candidates in story order, and returns them best fit first", async (t) => {
        useKeys(t);
        const sent = mockModels(t, {
            grade: gradeByText([
                ["HARBOR", 3],
                ["ALLEY", 3],
            ]),
        });
        const response = await search({ q: "the alley at night", limit: "50" });
        assert.equal(response.status, 200, response.text);
        // Both grade 3, so the closer match by meaning and words comes first.
        assert.deepEqual(
            response.body.scenes.map((row) => row.id),
            [alley.id, harbor.id]
        );
        const prompt = sent.gradings[0].body.input;
        assert.ok(prompt.indexOf(harbor.scene_text) < prompt.indexOf(alley.scene_text));
    });

    test("accepts a scene containing the description as an exact phrase, whatever its grade", async (t) => {
        useKeys(t);
        mockModels(t, { grade: (query, scenes) => scenes.map(({ label }) => ({ scene: label, grade: 0 })) });
        const phrase = await search({ q: "Footsteps echo", limit: "5" });
        assert.equal(phrase.status, 200, phrase.text);
        assert.deepEqual(
            phrase.body.scenes.map((row) => row.id),
            [unembedded.id]
        );

        const reordered = await search({ q: "echo footsteps", limit: "5" });
        assert.equal(reordered.status, 200, reordered.text);
        assert.deepEqual(reordered.body.scenes, []);
    });

    test("finds a scene by its words before it has an embedding", async (t) => {
        useKeys(t);
        mockModels(t, { grade: gradeByText([["STAIRWELL", 3]]) });
        assert.equal(await hasEmbedding(unembedded.id), false);

        const response = await search({ q: "footsteps echoing in a stairwell", limit: "5" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            response.body.scenes.map((row) => row.id),
            [unembedded.id]
        );
    });

    test("applies the tag filters to both retrievers", async (t) => {
        useKeys(t);
        const sent = mockModels(t);
        const onlyRevelation = await search({
            q: "from the harbor out into the alley",
            tags: TAGS.revelation,
            limit: "50",
        });
        assert.equal(onlyRevelation.status, 200, onlyRevelation.text);
        assert.deepEqual(
            onlyRevelation.body.scenes.map((row) => row.id),
            [alley.id]
        );
        // The harbor scene matches by meaning and by words, but its tags keep
        // it from being graded at all.
        assert.ok(!sent.gradings[0].body.input.includes(harbor.scene_text));

        const eitherTag = await search({
            q: "from the harbor out into the alley",
            tags: `${TAGS.protagonist},${TAGS.revelation}`,
            match: "any",
            limit: "50",
        });
        assert.deepEqual(
            new Set(eitherTag.body.scenes.map((row) => row.id)),
            new Set([harbor.id, alley.id])
        );
    });

    test("skips grading when no scene is a candidate", async (t) => {
        useKeys(t);
        const sent = mockModels(t);
        const response = await search({ q: "from the harbor out into the alley", tags: "tone:awe", limit: "50" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(response.body, { scenes: [] });
        assert.equal(sent.gradings.length, 0);
    });

    test("scopes both retrievers before ranking and grading, together with tag filters", async (t) => {
        useKeys(t);
        const sent = mockModels(t);
        const other = await createFilmWithScript(api, cookie, { title: "Another Harbor" });
        // Remove the extra film so subsequent unscoped searches keep their fixtures.
        t.after(async () => {
            await sceneEmbeddingsSettled();
            await pool.query("DELETE FROM movies WHERE id = $1", [other.film.id]);
        });
        const elsewhere = await createScene(api, cookie, other, {
            scene_text: "## EXT. ANOTHER HARBOR - DAY\n\nA harbor beside an alley, in another film.",
            tags: [TAGS.protagonist, TAGS.revelation],
        });
        await sceneEmbeddingsSettled();
        assert.equal(await hasEmbedding(elsewhere.id), true);

        for (const [tags, match, expected] of [
            ["", "all", [harbor.id, alley.id]],
            [TAGS.protagonist, "all", [harbor.id]],
            [`${TAGS.protagonist},${TAGS.revelation}`, "any", [harbor.id, alley.id]],
            [`${TAGS.protagonist},${TAGS.revelation}`, "all", []],
        ]) {
            const response = await search({ q: "harbor alley", scriptId: place.script.id, tags, match, limit: "50" });
            assert.equal(response.status, 200, response.text);
            assert.deepEqual(new Set(response.body.scenes.map((scene) => scene.id)), new Set(expected));
        }
        for (const request of sent.gradings) {
            assert.ok(!request.body.input.includes(elsewhere.scene_text), "out-of-scope scenes never reach grading");
        }

        const isolated = await search({ q: "harbor alley", scriptId: other.script.id, limit: "1" });
        assert.deepEqual(isolated.body.scenes.map((scene) => scene.id), [elsewhere.id]);
    });

    test("respects the requested result limit", async (t) => {
        useKeys(t);
        mockModels(t);
        const one = await search({ q: "from the harbor out into the alley", limit: "1" });
        assert.equal(one.body.scenes.length, 1);
        const many = await search({ q: "from the harbor out into the alley", limit: "50" });
        assert.deepEqual(
            new Set(many.body.scenes.map((row) => row.id)),
            new Set([harbor.id, alley.id])
        );
    });

    test("re-embeds a saved scene in the background only when its text changes", async (t) => {
        useKeys(t);
        const sent = mockModels(t);
        const save = (sceneText) =>
            api.put(`${scenesPath(place)}/${harbor.id}`, {
                cookie,
                body: {
                    script_key: place.script.s3_key,
                    start_time_seconds: harbor.start_time_seconds,
                    end_time_seconds: harbor.end_time_seconds,
                    script_location: harbor.script_location,
                    scene_text: sceneText,
                    tags: harbor.tags,
                },
            });

        const unchanged = await save(harbor.scene_text);
        assert.equal(unchanged.status, 200, unchanged.text);
        await sceneEmbeddingsSettled();
        assert.equal(sent.embeddings.length, 0);

        const changedText = "## INT. HARBOR CAFE - NIGHT\n\nMara wipes down an empty counter.";
        const updated = await save(changedText);
        assert.equal(updated.status, 200, updated.text);
        await sceneEmbeddingsSettled();
        assert.equal(sent.embeddings.length, 1);
        assert.equal(sent.embeddings[0].body.requests.length, 1);
        assert.equal(sent.embeddings[0].body.requests[0].taskType, "RETRIEVAL_DOCUMENT");
        assert.ok(sent.embeddings[0].body.requests[0].content.parts[0].text.includes(changedText));

        const current = await indexScenes(pool, { sceneIds: [harbor.id] });
        assert.equal(current.indexed_count, 0);
    });

    test("embeds a newly captured scene without holding up the save", async (t) => {
        useKeys(t);
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const sent = mockModels(t, {
            embed: async (inputs) => {
                await gate;
                return inputs.map(vectorFor);
            },
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
            sent.embeddings.flatMap((request) => request.body.requests.map((item) => item.content.parts[0].text)),
            sceneEmbeddingInputs(quiet)
        );

        const response = await search({ q: "somewhere quiet", limit: "1" });
        assert.equal(response.body.scenes[0].id, quiet.id);
    });

    test("embeds a long scene in chunks and ranks it by its closest chunk", async (t) => {
        useKeys(t);
        const sent = mockModels(t, { grade: (query, scenes) => scenes.map(({ label }) => ({ scene: label, grade: 3 })) });
        const beats = Array.from({ length: 26 }, (_, index) => `Beat ${index}: ${"The crew waits by the boats. ".repeat(12).trim()}`);
        const docks = await createScene(api, cookie, place, {
            start_time_seconds: 100,
            end_time_seconds: 110,
            // Only the last chunk mentions the lighthouse, and only inside a
            // longer word, so word search can't find it.
            scene_text: ["## EXT. DOCKS - NIGHT", ...beats, "The lighthousekeeper raises a lantern."].join("\n\n"),
            tags: [TAGS.protagonist],
        });
        await sceneEmbeddingsSettled();

        const inputs = sent.embeddings.flatMap((request) => request.body.requests.map((item) => item.content.parts[0].text));
        assert.deepEqual(inputs, sceneEmbeddingInputs(docks));
        assert.ok(inputs.length >= 2, `${inputs.length} chunks`);
        assert.ok(!inputs[0].includes("lighthouse") && inputs.at(-1).includes("lighthouse"));
        const stored = await pool.query("SELECT chunk FROM scene_chunk_embeddings WHERE scene_id = $1 ORDER BY chunk", [
            docks.id,
        ]);
        assert.deepEqual(
            stored.rows.map((row) => row.chunk),
            inputs.map((_, index) => index)
        );

        // The grader accepts every candidate, so the order is the retrievers'.
        const response = await search({ q: "lighthouse", limit: "1" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            response.body.scenes.map((row) => row.id),
            [docks.id]
        );
    });

    test("keeps a scene saved when its embedding fails", async (t) => {
        useKeys(t);
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
        useKeys(t);
        const sent = mockModels(t);

        await queueAllSceneEmbeddings(pool);
        await sceneEmbeddingsSettled();
        assert.ok(sent.embeddings.length >= 1);
        assert.equal(await hasEmbedding(unembedded.id), true);

        const status = await api.get(`${SEARCH_PATH}/status`);
        assert.equal(status.status, 200, status.text);
        assert.equal(status.body.configured, true);
        assert.equal(status.body.pending_count, 0);
        assert.equal(status.body.indexed_count, status.body.total_count);

        const count = sent.embeddings.length;
        await queueAllSceneEmbeddings(pool);
        await sceneEmbeddingsSettled();
        assert.equal(sent.embeddings.length, count);
    });

    test("reports an embedding failure as a 502", async (t) => {
        useKeys(t);
        t.mock.method(console, "error", () => {});
        const requestFetch = globalThis.fetch;
        t.mock.method(globalThis, "fetch", async (url, init) => {
            if (!String(url).includes("generativelanguage.googleapis.com")) return requestFetch(url, init);
            return new Response("upstream down", { status: 500 });
        });

        const response = await search({ q: "harbor" });
        assert.equal(response.status, 502, response.text);
        assert.deepEqual(response.body, { error: UPSTREAM });
    });

    test("fails the search when grading fails, rather than return ungraded scenes", async (t) => {
        useKeys(t);
        t.mock.method(console, "error", () => {});
        mockModels(t, { grade: () => new Response("overloaded", { status: 503 }) });
        const failed = await search({ q: "harbor" });
        assert.equal(failed.status, 502, failed.text);
        assert.deepEqual(failed.body, { error: UPSTREAM });
    });

    test("fails the search when the grades can't be read", async (t) => {
        useKeys(t);
        const errors = t.mock.method(console, "error", () => {});
        const replies = [
            jsonReply(openaiOutput("not json")),
            jsonReply(openaiOutput(JSON.stringify([{ scene: "S1", grade: 3 }]))),
            jsonReply(openaiOutput([{ type: "refusal", refusal: "I can't help with that." }])),
            jsonReply({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }),
            new Response("<html>", { status: 200, headers: { "content-type": "application/json" } }),
        ];
        mockModels(t, { grade: () => replies.shift() });
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const response = await search({ q: "harbor" });
            assert.equal(response.status, 502, response.text);
            assert.deepEqual(response.body, { error: UPSTREAM });
        }
        const logged = errors.mock.calls.map((call) => String(call.arguments[0]));
        assert.ok(logged.some((line) => line.includes("(refusal)")));
        assert.ok(logged.some((line) => line.includes("(max_output_tokens)")));
    });

    test("reads the grades from the last message when a draft comes first", async (t) => {
        useKeys(t);
        mockModels(t, {
            grade: (query, scenes) =>
                jsonReply({
                    status: "completed",
                    output: [
                        ...openaiOutput('{"grades":[]} Need output exact.').output,
                        ...openaiOutput(JSON.stringify({ grades: gradeByTopic(query, scenes) })).output,
                    ],
                }),
        });
        const response = await search({ q: "harbor", limit: "50" });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            response.body.scenes.map((row) => row.id),
            [harbor.id]
        );
    });

    test("reports a grading timeout as a 504", async (t) => {
        useKeys(t);
        mockModels(t, {
            grade: () => {
                throw new DOMException("The operation was aborted.", "AbortError");
            },
        });
        const response = await search({ q: "harbor" });
        assert.equal(response.status, 504, response.text);
        assert.deepEqual(response.body, { error: "Semantic search timed out. Try again." });
    });

    test("rejects a malformed embedding vector", async (t) => {
        useKeys(t);
        t.mock.method(console, "error", () => {});
        mockModels(t, { embed: (inputs) => inputs.map(() => []) });

        const response = await search({ q: "harbor" });
        assert.equal(response.status, 502, response.text);
        assert.deepEqual(response.body, { error: UPSTREAM });
    });

    test("limits an address to 20 searches a minute, and only counts searches it runs", async (t) => {
        useKeys(t);
        const sent = mockModels(t);
        const address = freshAddress();
        const invalid = await search({ q: "harbor", limit: "0" }, address);
        assert.equal(invalid.status, 400, invalid.text);

        for (let count = 0; count < 20; count += 1) {
            const response = await search({ q: "harbor", limit: "1" }, address);
            assert.equal(response.status, 200, response.text);
        }
        const gradings = sent.gradings.length;
        const refused = await search({ q: "harbor", limit: "1" }, address);
        assert.equal(refused.status, 429, refused.text);
        assert.match(refused.body.error, /^Too many searches\. Try again in \d+ seconds?\.$/);
        assert.ok(refused.body.retry_after_seconds > 0 && refused.body.retry_after_seconds <= 60);
        // A refused search never reaches the grader, and other visitors keep searching.
        assert.equal(sent.gradings.length, gradings);
        const other = await search({ q: "harbor", limit: "1" });
        assert.equal(other.status, 200, other.text);
    });

    test("answers 503 with only the Gemini key, and keeps indexing", async (t) => {
        useKeys(t, { openai: false });
        const errors = t.mock.method(console, "error", () => {});
        const sent = mockModels(t);

        const response = await search({ q: "harbor" });
        assert.equal(response.status, 503, response.text);
        assert.deepEqual(response.body, { error: DISABLED });
        assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes("OPENAI_API_KEY is not set")));
        assert.equal(sent.embeddings.length + sent.gradings.length, 0);

        const status = await api.get(`${SEARCH_PATH}/status`);
        assert.equal(status.body.configured, false);

        const pier = await createScene(api, cookie, place, {
            start_time_seconds: 120,
            end_time_seconds: 130,
            scene_text: "## EXT. PIER - DUSK\n\nGulls circle the empty boats.",
        });
        await sceneEmbeddingsSettled();
        assert.equal(await hasEmbedding(pier.id), true);
    });

    test("answers 503 with only the OpenAI key", async (t) => {
        useKeys(t, { gemini: false });
        const errors = t.mock.method(console, "error", () => {});
        const sent = mockModels(t);

        const response = await search({ q: "harbor" });
        assert.equal(response.status, 503, response.text);
        assert.deepEqual(response.body, { error: DISABLED });
        assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes("GEMINI_API_KEY is not set")));
        assert.equal(sent.embeddings.length + sent.gradings.length, 0);
    });
});

describe("admitSearch", () => {
    test("admits an address again once its minute has passed", () => {
        const start = 1_000_000;
        for (let count = 0; count < 20; count += 1) assert.equal(admitSearch("unit-test", start + count), 0);
        assert.equal(admitSearch("unit-test", start + 30_000), 30);
        assert.equal(admitSearch("unit-test", start + 59_500), 1);
        assert.equal(admitSearch("unit-test", start + 60_000), 0);
    });
});
