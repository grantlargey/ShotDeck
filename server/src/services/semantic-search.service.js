import { createHash } from "node:crypto";
import { withTransaction } from "../db.js";
import { getScriptTagLabel } from "../domain/script-tags.js";
import { HttpError } from "../utils/http-error.js";
import { listScenesByIds } from "./script-scenes.service.js";

/*
 * Semantic scene search: the module behind the semantic routes in
 * routes/script-scenes.routes.js.
 *
 * A captured scene is embedded once from its scene text and the labels of its
 * tags, and the vector is stored in scene_embeddings. A search embeds only the
 * visitor's description and ranks the indexed scenes by cosine similarity.
 * Gemini is optional: without GEMINI_API_KEY the semantic endpoints answer 503,
 * and tag browsing keeps working.
 */

// gemini-embedding-001 is the stable text-only embedding model. It supports
// taskType, which lets indexes and queries be embedded for retrieval; the
// newer multimodal gemini-embedding-2 does not support taskType.
const MODEL = "gemini-embedding-001";
const MODEL_RESOURCE = `models/${MODEL}`;
const EMBEDDINGS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;
// One of the model's recommended sizes, and far cheaper to store than its 3072
// default. Cosine similarity normalizes the truncated vectors.
const EMBEDDING_DIMENSIONS = 768;
const DOCUMENT_TASK = "RETRIEVAL_DOCUMENT";
const QUERY_TASK = "RETRIEVAL_QUERY";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_QUERY_LENGTH = 500;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 50;
// Ranking happens in the API process, so the candidate set is bounded.
const MAX_CANDIDATES = 5_000;
// Gemini accepts at most 100 requests per batch; stay well below that, and
// keep a batch's total text small enough for the request token limit.
const INDEX_BATCH_SIZE = 64;
const MAX_BATCH_INPUT_CHARS = 60_000;
// The model accepts 2,048 tokens per input; ~5,000 English characters is about
// 1,250 tokens, leaving room for the tag prefix.
const MAX_EMBEDDING_INPUT_CHARS = 5_000;
const DISABLED_MESSAGE = "Semantic search isn't available right now.";
const UPSTREAM_MESSAGE = "The semantic search request failed. Try again.";

const UPSERT_EMBEDDING_SQL = `
    INSERT INTO scene_embeddings (scene_id, model, source_hash, embedding)
    VALUES ($1, $2, $3, $4::real[])
    ON CONFLICT (scene_id) DO UPDATE SET
      model = EXCLUDED.model,
      source_hash = EXCLUDED.source_hash,
      embedding = EXCLUDED.embedding,
      updated_at = NOW()`;

/** The Gemini key, or an empty string when semantic search is not configured. */
function geminiApiKey() {
    return process.env.GEMINI_API_KEY || "";
}

/**
 * The text an embedding represents: the scene's tags as people read them, then
 * the captured scene text. Editing either makes the stored embedding stale.
 */
export function sceneEmbeddingInput(scene) {
    const tags = Array.isArray(scene?.tags) ? scene.tags.map(String) : [];
    const labelList = tags.map(getScriptTagLabel);
    const tagLine = labelList.length > 0 ? `Tags: ${labelList.join(", ")}` : "Tags: none";
    const text = typeof scene?.scene_text === "string" ? scene.scene_text.trim() : "";
    return `${tagLine}\n\n${text}`.slice(0, MAX_EMBEDDING_INPUT_CHARS);
}

function hashEmbeddingInput(input) {
    return createHash("sha256").update(input).digest("hex");
}

/** Splits indexing work into Gemini batches by request count and total text size. */
export function batchEmbeddingWork(work, { maxItems = INDEX_BATCH_SIZE, maxChars = MAX_BATCH_INPUT_CHARS } = {}) {
    const batches = [];
    let current = [];
    let characters = 0;

    for (const item of work) {
        const size = item.input.length;
        if (current.length > 0 && (current.length >= maxItems || characters + size > maxChars)) {
            batches.push(current);
            current = [];
            characters = 0;
        }
        current.push(item);
        characters += size;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

/** Cosine similarity of two vectors, or 0 when either is unusable. */
export function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < a.length; index += 1) {
        const left = Number(a[index]);
        const right = Number(b[index]);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
        dot += left * right;
        normA += left * left;
        normB += right * right;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / Math.sqrt(normA * normB);
}

/** Embeddings for what exists now, stitched to each scene's movie title. */
export async function searchScenesSemantically(pool, { query, limit, tags = [], match = "all" }) {
    const request = readSearchRequest({ query, limit });
    const apiKey = geminiApiKey();
    if (!apiKey) {
        console.error("Semantic search is disabled: GEMINI_API_KEY is not set.");
        throw new HttpError(503, DISABLED_MESSAGE);
    }

    const [vectors, index] = await Promise.all([embedTexts([request.query], apiKey, QUERY_TASK), countIndexState(pool)]);
    const ranked = (await rankScenes(pool, { vector: vectors[0], tags, match })).slice(0, request.limit);
    const scenesById = new Map(
        (await listScenesByIds(pool, ranked.map((row) => row.id))).map((scene) => [scene.id, scene])
    );
    const scenes = ranked.flatMap(({ id, similarity }) => {
        const scene = scenesById.get(id);
        return scene ? [{ ...scene, similarity }] : [];
    });

    return { model: MODEL, scenes, index };
}

/** Whether semantic search can run, and how much of the scene library is indexed. */
export async function getSemanticSearchStatus(pool) {
    return {
        configured: Boolean(geminiApiKey()),
        model: MODEL,
        ...(await countIndexState(pool)),
    };
}

/**
 * Embeds scenes whose text, tags or model differ from what is stored. With
 * `sceneIds`, limits the work to those scenes; otherwise every scene is
 * considered. Returns counts so the caller can report progress.
 */
export async function indexScenes(pool, { sceneIds = null } = {}) {
    const apiKey = geminiApiKey();
    if (!apiKey) {
        console.error("Semantic indexing is disabled: GEMINI_API_KEY is not set.");
        throw new HttpError(503, DISABLED_MESSAGE);
    }

    const values = [];
    let filter = "";
    if (Array.isArray(sceneIds)) {
        if (sceneIds.length === 0) {
            return { model: MODEL, indexed_count: 0, current_count: 0, total_count: 0 };
        }
        values.push(sceneIds);
        filter = "WHERE sc.id = ANY($1::uuid[])";
    }

    const result = await pool.query(
        `SELECT sc.id, sc.scene_text, sc.tags,
                e.model AS stored_model, e.source_hash AS stored_hash
         FROM captured_scenes sc
         LEFT JOIN scene_embeddings e ON e.scene_id = sc.id
         ${filter}
         ORDER BY sc.id`,
        values
    );

    const work = [];
    for (const row of result.rows) {
        const input = sceneEmbeddingInput(row);
        const sourceHash = hashEmbeddingInput(input);
        if (row.stored_model === MODEL && row.stored_hash === sourceHash) continue;
        work.push({ id: row.id, input, sourceHash });
    }

    for (const batch of batchEmbeddingWork(work)) {
        const vectors = await embedTexts(
            batch.map((item) => item.input),
            apiKey,
            DOCUMENT_TASK
        );
        await withTransaction(pool, async (client) => {
            for (let index = 0; index < batch.length; index += 1) {
                await client.query(UPSERT_EMBEDDING_SQL, [batch[index].id, MODEL, batch[index].sourceHash, vectors[index]]);
            }
        });
    }

    return {
        model: MODEL,
        indexed_count: work.length,
        current_count: result.rows.length - work.length,
        total_count: result.rows.length,
    };
}

async function rankScenes(pool, { vector, tags, match }) {
    const anyTag = match === "any";
    const values = [MODEL];
    let tagFilter = "";
    if (tags.length > 0) {
        values.push(anyTag ? tags : JSON.stringify(tags));
        tagFilter = anyTag ? "AND sc.tags ?| $2::text[]" : "AND sc.tags @> $2::jsonb";
    }

    const result = await pool.query(
        `SELECT e.scene_id AS id, e.embedding
         FROM scene_embeddings e
         JOIN captured_scenes sc ON sc.id = e.scene_id
         WHERE e.model = $1 ${tagFilter}
         ORDER BY e.scene_id
         LIMIT ${MAX_CANDIDATES}`,
        values
    );

    return result.rows
        .filter((row) => Array.isArray(row.embedding) && row.embedding.length > 0)
        .map((row) => ({ id: row.id, similarity: cosineSimilarity(vector, row.embedding) }))
        .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
}

async function countIndexState(pool) {
    const result = await pool.query(
        `SELECT
           count(*) FILTER (WHERE e.scene_id IS NOT NULL)::int AS indexed_count,
           count(*) FILTER (WHERE e.scene_id IS NULL)::int AS pending_count
         FROM captured_scenes sc
         LEFT JOIN scene_embeddings e ON e.scene_id = sc.id AND e.model = $1`,
        [MODEL]
    );
    const row = result.rows[0] ?? { indexed_count: 0, pending_count: 0 };
    return {
        indexed_count: row.indexed_count,
        pending_count: row.pending_count,
        total_count: row.indexed_count + row.pending_count,
    };
}

function readSearchRequest({ query, limit }) {
    if (typeof query !== "string" || query.trim() === "") {
        throw new HttpError(400, "Invalid query. q must be a non-empty string.");
    }
    if (query.length > MAX_QUERY_LENGTH) {
        throw new HttpError(413, `That description is too long. Keep it under ${MAX_QUERY_LENGTH} characters.`);
    }

    let requested = DEFAULT_RESULT_LIMIT;
    if (limit !== undefined) {
        requested =
            typeof limit === "number"
                ? limit
                : typeof limit === "string" && limit.trim() !== ""
                  ? Number(limit)
                  : NaN;
        if (!Number.isInteger(requested) || requested < 1 || requested > MAX_RESULT_LIMIT) {
            throw new HttpError(400, `Invalid limit. limit must be a whole number from 1 to ${MAX_RESULT_LIMIT}.`);
        }
    }

    return { query: query.trim(), limit: requested };
}

/** One Gemini batchEmbedContents request for `inputs`, in input order. */
async function embedTexts(inputs, apiKey, taskType) {
    const configuredTimeout = Number(process.env.GEMINI_EMBEDDING_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(EMBEDDINGS_URL, {
            method: "POST",
            headers: {
                "x-goog-api-key": apiKey,
                "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify({
                requests: inputs.map((text) => ({
                    model: MODEL_RESOURCE,
                    content: { parts: [{ text }] },
                    // The API reference marks these deprecated in favor of
                    // embedContentConfig, but the live batchEmbedContents
                    // endpoint for gemini-embedding-001 only honors the
                    // top-level fields; the nested config is ignored and
                    // returns the default 3072 dimensions.
                    taskType,
                    outputDimensionality: EMBEDDING_DIMENSIONS,
                })),
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            console.error(`Gemini embedding request failed (${response.status}): ${body}`);
            throw new HttpError(502, UPSTREAM_MESSAGE);
        }

        const payload = await response.json();
        const embeddings = Array.isArray(payload?.embeddings) ? payload.embeddings : [];
        if (embeddings.length !== inputs.length) {
            console.error(`Gemini returned ${embeddings.length} embeddings for ${inputs.length} inputs.`);
            throw new HttpError(502, UPSTREAM_MESSAGE);
        }

        const vectors = embeddings.map((entry) => entry?.values);
        const width = vectors[0]?.length;
        if (!isVector(vectors[0]) || vectors.some((vector) => !isVector(vector) || vector.length !== width)) {
            console.error("Gemini returned a malformed embedding vector.");
            throw new HttpError(502, UPSTREAM_MESSAGE);
        }
        return vectors;
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new HttpError(504, "Semantic search timed out. Try again.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function isVector(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => Number.isFinite(item));
}
