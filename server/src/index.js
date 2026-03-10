// server/src/index.js
import express from "express";
import cors from "cors";
import "./env.js";

import { pool } from "./db.js";
import { v4 as uuidv4 } from "uuid";
import { ensureMovieExists, createAnnotationRecord } from "./annotation-service.js";
import {
    buildObjectKey,
    createPresignedPutUrl,
    createPresignedGetUrl,
    getExtensionForContentType,
} from "./s3.js";

const app = express();

const allowedOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    ...(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
]);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.has(origin)) {
                return callback(null, true);
            }
            return callback(null, false);
        },
    })
);
app.use(express.json({ limit: "2mb" })); // metadata only; no big file uploads

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/annotations/format", async (req, res) => {
    const rawText = req.body?.rawText;

    if (typeof rawText !== "string" || !rawText.trim()) {
        return res.status(400).json({ error: "Invalid body. Expected { rawText:string }" });
    }

    if (rawText.length > 50000) {
        return res.status(400).json({ error: "rawText is too large." });
    }

    try {
        const { formattedText, accepted } = await formatAnnotationTextWithOpenAI(rawText);
        return res.json({
            rawText,
            formattedText: formattedText || rawText,
            accepted: Boolean(accepted),
        });
    } catch (err) {
        console.error("POST /api/annotations/format error:", err?.message || err);
        return res.json({
            rawText,
            formattedText: rawText,
            accepted: false,
        });
    }
});

function normalizeLinks(value) {
    if (value === undefined) return undefined; // means "not provided" (preserve existing)
    if (value === null) return []; // treat explicit null as empty list
    if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof value === "string") {
        return value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    // anything else is invalid
    return "__INVALID__";
}

function normalizeTags(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof value === "string") {
        return value
            .split(/[,\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return "__INVALID__";
}

function isFiniteInt(value) {
    return Number.isFinite(value) && Number.isInteger(value);
}

function extractResponseOutputText(payload) {
    if (!payload || typeof payload !== "object") return "";
    if (typeof payload.output_text === "string") return payload.output_text;

    const blocks = Array.isArray(payload.output) ? payload.output : [];
    const parts = [];

    for (const block of blocks) {
        const content = Array.isArray(block?.content) ? block.content : [];
        for (const item of content) {
            if (item?.type === "output_text" && typeof item.text === "string") {
                parts.push(item.text);
            }
        }
    }

    return parts.join("\n").trim();
}

async function formatAnnotationTextWithOpenAI(rawText) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { formattedText: rawText, accepted: false };
    }

    const model = process.env.OPENAI_FORMAT_MODEL || "gpt-4.1-mini";
    const timeoutMs = Number(process.env.OPENAI_FORMAT_TIMEOUT_MS || 10000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                input: [
                    {
                        role: "system",
                        content: [
                            {
                                type: "input_text",
                                text:
                                    "You format messy PDF text selections for annotations.\n" +
                                    "preserve original wording\n" +
                                    "do not summarize\n" +
                                    "do not paraphrase\n" +
                                    "do not invent or complete missing text\n" +
                                    "only improve whitespace, spacing, and line breaks\n" +
                                    "remove obvious standalone margin/page/scene number artifacts only when they clearly look like junk tokens\n" +
                                    "Return plain text only.",
                            },
                        ],
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: `RAW TEXT:\n<<<\n${rawText}\n>>>`,
                            },
                        ],
                    },
                ],
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`OpenAI formatter request failed (${response.status}): ${body}`);
        }

        const payload = await response.json();
        const formattedText = extractResponseOutputText(payload);

        if (!formattedText || !formattedText.trim()) {
            return { formattedText: rawText, accepted: false };
        }

        return { formattedText, accepted: true };
    } finally {
        clearTimeout(timeout);
    }
}

async function withMovieCoverUrl(movieRow) {
    if (!movieRow) return movieRow;
    if (!movieRow.cover_image_key) return { ...movieRow, cover_image_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: movieRow.cover_image_key });
        return { ...movieRow, cover_image_url: url };
    } catch (err) {
        console.error("Failed to sign movie cover URL:", movieRow.cover_image_key, err?.message);
        return { ...movieRow, cover_image_url: null };
    }
}

async function withAnnotationImageUrl(row) {
    if (!row) return row;
    if (!row.image_key) return { ...row, image_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: row.image_key });
        return { ...row, image_url: url };
    } catch (err) {
        console.error("Failed to sign annotation image URL:", row.image_key, err?.message);
        return { ...row, image_url: null };
    }
}

async function withScriptViewUrl(row) {
    if (!row) return row;
    if (!row.s3_key) return { ...row, script_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: row.s3_key });
        return { ...row, script_url: url };
    } catch (err) {
        console.error("Failed to sign script URL:", row.s3_key, err?.message);
        return { ...row, script_url: null };
    }
}

function normalizeAnchorGeometry(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : "__INVALID__";
        } catch {
            return "__INVALID__";
        }
    }
    return "__INVALID__";
}

function normalizeOptionalInt(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const num = Number(value);
    return Number.isInteger(num) ? num : NaN;
}

const SCRIPT_SCENE_SELECT_FIELDS_SQL = `
      sc.id,
      sc.anchor_id,
      sc.legacy_annotation_id,
      sc.movie_id,
      sc.script_id,
      sc.start_time_seconds,
      sc.end_time_seconds,
      sc.tags,
      sc.scene_label,
      sc.scene_summary,
      sc.created_at,
      sc.updated_at,
      a.page_start,
      a.page_end,
      a.selected_text,
      a.raw_selected_text,
      a.formatted_selected_text,
      a.context_prefix,
      a.context_suffix,
      a.start_offset,
      a.end_offset,
      a.anchor_geometry,
      a.created_at AS anchor_created_at,
      a.updated_at AS anchor_updated_at,
      first_image_ann.first_image_annotation_id,
      first_image_ann.first_image_annotation_time_seconds,
      first_image_ann.first_image_annotation_title,
      first_image_ann.first_image_annotation_image_key,
      first_image_ann.first_image_annotation_created_at
`;

const SCRIPT_SCENE_FROM_SQL = `
    FROM script_scene_annotations sc
    JOIN script_scene_anchors a ON a.id = sc.anchor_id
    LEFT JOIN LATERAL (
      SELECT
        ann.id AS first_image_annotation_id,
        ann.time_seconds AS first_image_annotation_time_seconds,
        ann.title AS first_image_annotation_title,
        ann.image_key AS first_image_annotation_image_key,
        ann.created_at AS first_image_annotation_created_at
      FROM annotations ann
      WHERE ann.movie_id = sc.movie_id
        AND COALESCE(ann.image_key, '') <> ''
        AND ann.time_seconds >= sc.start_time_seconds
        AND ann.time_seconds <= sc.end_time_seconds
      ORDER BY ann.time_seconds ASC, ann.created_at ASC, ann.id ASC
      LIMIT 1
    ) first_image_ann ON TRUE
`;

const SCRIPT_SCENE_SELECT_SQL = `
    SELECT
${SCRIPT_SCENE_SELECT_FIELDS_SQL}
    ${SCRIPT_SCENE_FROM_SQL}
`;

function mapScriptSceneRow(row) {
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    const anchorGeometry = Array.isArray(row?.anchor_geometry) ? row.anchor_geometry : [];
    const firstImageAnnotation = row?.first_image_annotation_id
        ? {
            id: row.first_image_annotation_id,
            time_seconds: row.first_image_annotation_time_seconds,
            title: row.first_image_annotation_title,
            image_key: row.first_image_annotation_image_key,
            created_at: row.first_image_annotation_created_at,
        }
        : null;

    return {
        id: row.id,
        anchor_id: row.anchor_id,
        movie_id: row.movie_id,
        script_id: row.script_id,
        start_time_seconds: row.start_time_seconds,
        end_time_seconds: row.end_time_seconds,
        tags,
        scene_label: row.scene_label,
        scene_summary: row.scene_summary,
        created_at: row.created_at,
        updated_at: row.updated_at,
        page_start: row.page_start,
        page_end: row.page_end,
        selected_text: row.selected_text,
        raw_selected_text: row.raw_selected_text,
        formatted_selected_text: row.formatted_selected_text,
        context_prefix: row.context_prefix,
        context_suffix: row.context_suffix,
        start_offset: row.start_offset,
        end_offset: row.end_offset,
        anchor_geometry: anchorGeometry,
        first_image_annotation: firstImageAnnotation,
        anchor: {
            id: row.anchor_id,
            page_start: row.page_start,
            page_end: row.page_end,
            selected_text: row.selected_text,
            raw_selected_text: row.raw_selected_text,
            formatted_selected_text: row.formatted_selected_text,
            context_prefix: row.context_prefix,
            context_suffix: row.context_suffix,
            start_offset: row.start_offset,
            end_offset: row.end_offset,
            anchor_geometry: anchorGeometry,
            created_at: row.anchor_created_at,
            updated_at: row.anchor_updated_at,
        },
        ...(row.movie_title ? { movie_title: row.movie_title } : {}),
        ...(row.script_url !== undefined ? { script_url: row.script_url } : {}),
    };
}

function getScriptSceneIdFromParams(params) {
    return params.sceneId || params.annotationId || "";
}

async function fetchScriptSceneRow(db, { sceneId, movieId, scriptId }) {
    const values = [sceneId];
    const where = [`sc.id = $1`];

    if (movieId) {
        values.push(movieId);
        where.push(`sc.movie_id = $${values.length}`);
    }
    if (scriptId) {
        values.push(scriptId);
        where.push(`sc.script_id = $${values.length}`);
    }

    const result = await db.query(
        `${SCRIPT_SCENE_SELECT_SQL} WHERE ${where.join(" AND ")} LIMIT 1`,
        values
    );
    return result.rows[0] || null;
}

async function findOverlappingScriptScene(
    db,
    { movieId, scriptId, startTimeSeconds, endTimeSeconds, excludeSceneId = "" }
) {
    const values = [movieId, scriptId, startTimeSeconds, endTimeSeconds];
    const where = [
        `sc.movie_id = $1`,
        `sc.script_id = $2`,
        `NOT (sc.end_time_seconds < $3 OR sc.start_time_seconds > $4)`,
    ];

    if (excludeSceneId) {
        values.push(excludeSceneId);
        where.push(`sc.id <> $${values.length}`);
    }

    const result = await db.query(
        `
        ${SCRIPT_SCENE_SELECT_SQL}
        WHERE ${where.join(" AND ")}
        ORDER BY sc.start_time_seconds ASC, sc.end_time_seconds ASC, sc.id ASC
        LIMIT 1
      `,
        values
    );

    return result.rows[0] || null;
}

/**
 * Movies
 * - POST /movies
 * - GET  /movies
 * - GET  /movies/:id
 * - PUT  /movies/:id
 * - DELETE /movies/:id
 */

// Create a movie
app.post("/movies", async (req, res) => {
    const { title, director, year, runtime_minutes, cover_image_key } = req.body;
    const linksNorm = normalizeLinks(req.body.links);

    // Basic validation
    if (
        typeof title !== "string" ||
        typeof director !== "string" ||
        typeof year !== "number" ||
        typeof runtime_minutes !== "number"
    ) {
        return res.status(400).json({
            error:
                "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) cover_image_key:string, (optional) links:string[] }",
        });
    }

    if (linksNorm === "__INVALID__") {
        return res.status(400).json({
            error: "Invalid body. 'links' must be an array of strings (or a newline-separated string).",
        });
    }

    const id = uuidv4();

    try {
        const result = await pool.query(
            `
        INSERT INTO movies (id, title, director, year, runtime_minutes, cover_image_key, links)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
            [
                id,
                title,
                director,
                year,
                runtime_minutes,
                cover_image_key ?? null,
                JSON.stringify(linksNorm === undefined ? [] : linksNorm),
            ]
        );

        const movie = await withMovieCoverUrl(result.rows[0]);
        return res.status(201).json(movie);
    } catch (err) {
        console.error("POST /movies error:", err);
        return res.status(500).json({
            error:
                process.env.NODE_ENV === "production"
                    ? "Failed to create movie"
                    : `Failed to create movie: ${err?.message || "unknown error"}`,
        });
    }
});

// List all movies (with signed cover_image_url)
app.get("/movies", async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM movies ORDER BY created_at DESC`);
        const withUrls = await Promise.all(result.rows.map(withMovieCoverUrl));
        return res.json(withUrls);
    } catch (err) {
        console.error("GET /movies error:", err);
        return res.status(500).json({
            error:
                process.env.NODE_ENV === "production"
                    ? "Failed to fetch movies"
                    : `Failed to fetch movies: ${err?.message || "unknown error"}`,
        });
    }
});

// Get one movie by id (with signed cover_image_url)
app.get("/movies/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(`SELECT * FROM movies WHERE id = $1`, [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Movie not found" });

        const movie = await withMovieCoverUrl(result.rows[0]);
        return res.json(movie);
    } catch (err) {
        console.error("GET /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to fetch movie" });
    }
});

// Update a movie (preserve cover_image_key + links if not provided)
app.put("/movies/:id", async (req, res) => {
    const { id } = req.params;
    const { title, director, year, runtime_minutes, cover_image_key } = req.body;
    const linksNorm = normalizeLinks(req.body.links);

    if (
        typeof title !== "string" ||
        typeof director !== "string" ||
        typeof year !== "number" ||
        typeof runtime_minutes !== "number"
    ) {
        return res.status(400).json({
            error:
                "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) cover_image_key:string, (optional) links:string[] }",
        });
    }

    if (linksNorm === "__INVALID__") {
        return res.status(400).json({
            error: "Invalid body. 'links' must be an array of strings (or a newline-separated string).",
        });
    }

    try {
        // fetch existing so we can preserve cover_image_key and links if omitted
        const existingRes = await pool.query(`SELECT * FROM movies WHERE id = $1`, [id]);
        if (existingRes.rows.length === 0) return res.status(404).json({ error: "Movie not found" });

        const existing = existingRes.rows[0];

        const nextCoverKey =
            cover_image_key === undefined ? existing.cover_image_key : cover_image_key ?? null;

        const nextLinks =
            linksNorm === undefined ? existing.links ?? [] : linksNorm; // preserve if omitted

        const result = await pool.query(
            `
        UPDATE movies
        SET title = $2,
            director = $3,
            year = $4,
            runtime_minutes = $5,
            cover_image_key = $6,
            links = $7::jsonb
        WHERE id = $1
        RETURNING *
      `,
            [
                id,
                title,
                director,
                year,
                runtime_minutes,
                nextCoverKey,
                JSON.stringify(nextLinks),
            ]
        );

        const movie = await withMovieCoverUrl(result.rows[0]);
        return res.json(movie);
    } catch (err) {
        console.error("PUT /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to update movie" });
    }
});

app.delete("/movies/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `
        DELETE FROM movies
        WHERE id = $1
        RETURNING id
      `,
            [id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Movie not found" });
        return res.status(204).send();
    } catch (err) {
        console.error("DELETE /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to delete movie" });
    }
});

/**
 * Annotations
 * - POST /movies/:id/annotations
 * - GET  /movies/:id/annotations
 * - DELETE /movies/:movieId/annotations/:annotationId
 */

app.post("/movies/:id/annotations", async (req, res) => {
    const movieId = req.params.id;
    const { time_seconds, title, body, image_key } = req.body;

    if (typeof time_seconds !== "number" || typeof title !== "string") {
        return res.status(400).json({
            error:
                "Invalid body. Expected { time_seconds:number, title:string, (optional) body:string, (optional) image_key:string }",
        });
    }

    try {
        const movie = await ensureMovieExists(pool, movieId);
        if (!movie) return res.status(404).json({ error: "Movie not found" });

        const created = await createAnnotationRecord(pool, {
            movieId,
            timeSeconds: time_seconds,
            title,
            body,
            imageKey: image_key,
        });

        const row = await withAnnotationImageUrl(created);
        return res.status(201).json(row);
    } catch (err) {
        console.error("POST /movies/:id/annotations error:", err);
        return res.status(500).json({ error: "Failed to create annotation" });
    }
});

app.get("/movies/:id/annotations", async (req, res) => {
    const movieId = req.params.id;

    try {
        const result = await pool.query(
            `
        SELECT *
        FROM annotations
        WHERE movie_id = $1
        ORDER BY time_seconds ASC, created_at ASC
      `,
            [movieId]
        );

        const withUrls = await Promise.all(result.rows.map(withAnnotationImageUrl));
        return res.json(withUrls);
    } catch (err) {
        console.error("GET /movies/:id/annotations error:", err);
        return res.status(500).json({ error: "Failed to fetch annotations" });
    }
});

app.put("/movies/:movieId/annotations/:annotationId", async (req, res) => {
    try {
        const { movieId, annotationId } = req.params;
        const { time_seconds, title, body, image_key } = req.body || {};

        if (
            typeof time_seconds !== "number" ||
            !Number.isFinite(time_seconds) ||
            time_seconds < 0 ||
            typeof title !== "string" ||
            typeof body !== "string"
        ) {
            return res.status(400).json({
                error: "Invalid body. Expected { time_seconds:number, title:string, body:string, (optional) image_key:string }",
            });
        }

        const q = `
        UPDATE annotations
        SET time_seconds = $1,
            title = $2,
            body = $3,
            image_key = $4
        WHERE id = $5 AND movie_id = $6
        RETURNING *
      `;

        const result = await pool.query(q, [
            time_seconds,
            title,
            body,
            image_key ?? null,
            annotationId,
            movieId,
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Annotation not found" });
        }

        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete("/movies/:movieId/annotations/:annotationId", async (req, res) => {
    const { movieId, annotationId } = req.params;

    try {
        const result = await pool.query(
            `
        DELETE FROM annotations
        WHERE id = $1 AND movie_id = $2
        RETURNING id
      `,
            [annotationId, movieId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Annotation not found" });
        return res.status(204).send();
    } catch (err) {
        console.error("DELETE /movies/:movieId/annotations/:annotationId error:", err);
        return res.status(500).json({ error: "Failed to delete annotation" });
    }
});

/**
 * Scripts
 * - POST /movies/:id/scripts
 * - GET  /movies/:id/scripts
 * - GET  /movies/:movieId/scripts/:scriptId
 */
app.post("/movies/:id/scripts", async (req, res) => {
    const movieId = req.params.id;
    const { s3_key } = req.body || {};
    const trimmedKey = typeof s3_key === "string" ? s3_key.trim() : "";

    if (!trimmedKey || !trimmedKey.startsWith("scripts/")) {
        return res.status(400).json({ error: "Invalid body. Expected { s3_key:string }" });
    }

    const id = uuidv4();
    try {
        const movieCheck = await pool.query(`SELECT id FROM movies WHERE id = $1`, [movieId]);
        if (movieCheck.rows.length === 0) return res.status(404).json({ error: "Movie not found" });

        const result = await pool.query(
            `
        INSERT INTO scripts (id, movie_id, s3_key)
        VALUES ($1, $2, $3)
        ON CONFLICT (movie_id)
        DO UPDATE SET s3_key = EXCLUDED.s3_key
        RETURNING *
      `,
            [id, movieId, trimmedKey]
        );

        const script = await withScriptViewUrl(result.rows[0]);
        return res.status(201).json(script);
    } catch (err) {
        console.error("POST /movies/:id/scripts error:", err);
        return res.status(500).json({ error: "Failed to save script" });
    }
});

app.get("/movies/:id/scripts", async (req, res) => {
    const movieId = req.params.id;

    try {
        const result = await pool.query(
            `
        SELECT *
        FROM scripts
        WHERE movie_id = $1
        ORDER BY created_at DESC
      `,
            [movieId]
        );

        const withUrls = await Promise.all(result.rows.map(withScriptViewUrl));
        return res.json(withUrls);
    } catch (err) {
        console.error("GET /movies/:id/scripts error:", err);
        return res.status(500).json({ error: "Failed to fetch scripts" });
    }
});

app.get("/movies/:movieId/scripts/:scriptId", async (req, res) => {
    const { movieId, scriptId } = req.params;

    try {
        const result = await pool.query(`SELECT * FROM scripts WHERE id = $1 AND movie_id = $2`, [
            scriptId,
            movieId,
        ]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Script not found" });

        const withUrl = await withScriptViewUrl(result.rows[0]);
        return res.json(withUrl);
    } catch (err) {
        console.error("GET /movies/:movieId/scripts/:scriptId error:", err);
        return res.status(500).json({ error: "Failed to fetch script" });
    }
});

app.get("/movies/:movieId/scene-by-time", async (req, res) => {
    const { movieId } = req.params;
    const timeRaw = req.query.time;
    const scriptIdRaw = req.query.script_id;

    const timeSeconds = Number(timeRaw);
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
        return res
            .status(400)
            .json({ error: "Invalid time query parameter. Expected non-negative number." });
    }

    const requestedScriptId =
        typeof scriptIdRaw === "string" && scriptIdRaw.trim() ? scriptIdRaw.trim() : null;

    try {
        let scriptRow = null;

        if (requestedScriptId) {
            const scriptResult = await pool.query(
                `
                SELECT id
                FROM scripts
                WHERE id = $1 AND movie_id = $2
                LIMIT 1
              `,
                [requestedScriptId, movieId]
            );
            scriptRow = scriptResult.rows[0] || null;
        } else {
            const scriptResult = await pool.query(
                `
                SELECT id
                FROM scripts
                WHERE movie_id = $1
                ORDER BY created_at DESC
                LIMIT 1
              `,
                [movieId]
            );
            scriptRow = scriptResult.rows[0] || null;
        }

        if (!scriptRow?.id) {
            return res.json({
                found: false,
                reason: "NO_SCRIPT",
                script_id: null,
                scene_id: null,
            });
        }

        const sceneResult = await pool.query(
            `
            SELECT
              sc.id AS scene_id,
              sc.script_id,
              sc.start_time_seconds,
              sc.end_time_seconds,
              a.page_start,
              a.page_end
            FROM script_scene_annotations sc
            JOIN script_scene_anchors a ON a.id = sc.anchor_id
            WHERE sc.movie_id = $1
              AND sc.script_id = $2
              AND sc.start_time_seconds <= $3
              AND sc.end_time_seconds >= $3
            ORDER BY
              (sc.end_time_seconds - sc.start_time_seconds) ASC,
              sc.start_time_seconds ASC,
              sc.id ASC
            LIMIT 1
          `,
            [movieId, scriptRow.id, timeSeconds]
        );

        if (sceneResult.rows.length === 0) {
            return res.json({
                found: false,
                reason: "NO_SCENE_FOR_TIMESTAMP",
                script_id: scriptRow.id,
                scene_id: null,
            });
        }

        const row = sceneResult.rows[0];
        return res.json({
            found: true,
            reason: null,
            script_id: row.script_id,
            scene_id: row.scene_id,
            page_start: row.page_start,
            page_end: row.page_end,
            start_time_seconds: row.start_time_seconds,
            end_time_seconds: row.end_time_seconds,
        });
    } catch (err) {
        console.error("GET /movies/:movieId/scene-by-time error:", err);
        return res.status(500).json({ error: "Failed to resolve scene by time" });
    }
});

/**
 * Script scene annotations (persistent scene anchors + metadata)
 * Canonical routes:
 * - POST   /movies/:movieId/scripts/:scriptId/scene-annotations
 * - GET    /movies/:movieId/scripts/:scriptId/scene-annotations
 * - PUT    /movies/:movieId/scripts/:scriptId/scene-annotations/:sceneId
 * - DELETE /movies/:movieId/scripts/:scriptId/scene-annotations/:sceneId
 * - GET    /script-scenes
 *
 * Backwards-compatible aliases:
 * - /movies/:movieId/scripts/:scriptId/annotations
 * - /movies/:movieId/scripts/:scriptId/annotations/:annotationId
 * - /script-annotations
 */
async function createScriptScene(req, res) {
    const { movieId, scriptId } = req.params;
    const {
        start_time_seconds,
        end_time_seconds,
        selected_text,
        raw_selected_text,
        formatted_selected_text,
        page_start,
        page_end,
        context_prefix,
        context_suffix,
        start_offset,
        end_offset,
        anchor_geometry,
        tags,
        scene_label,
        scene_summary,
    } = req.body || {};

    const startTime = Number(start_time_seconds);
    const endTime = Number(end_time_seconds);

    if (!isFiniteInt(startTime) || !isFiniteInt(endTime) || startTime < 0 || endTime < startTime) {
        return res.status(400).json({
            error:
                "Invalid body. start_time_seconds and end_time_seconds must be integers where end >= start and start >= 0.",
        });
    }

    const pageStartParsed =
        page_start === null ? null : normalizeOptionalInt(page_start);
    const pageEndParsed =
        page_end === null ? null : normalizeOptionalInt(page_end);

    if (
        Number.isNaN(pageStartParsed) ||
        Number.isNaN(pageEndParsed) ||
        (pageStartParsed !== undefined && pageStartParsed !== null && pageStartParsed < 1) ||
        (pageEndParsed !== undefined && pageEndParsed !== null && pageEndParsed < 1) ||
        (pageStartParsed !== undefined &&
            pageStartParsed !== null &&
            pageEndParsed !== undefined &&
            pageEndParsed !== null &&
            pageEndParsed < pageStartParsed)
    ) {
        return res.status(400).json({
            error: "Invalid body. page_start/page_end must be positive integers and page_end >= page_start.",
        });
    }

    if (
        (context_prefix !== undefined && context_prefix !== null && typeof context_prefix !== "string") ||
        (context_suffix !== undefined && context_suffix !== null && typeof context_suffix !== "string")
    ) {
        return res.status(400).json({
            error: "Invalid body. context_prefix/context_suffix must be strings when provided.",
        });
    }

    const startOffsetParsed =
        start_offset === null ? null : normalizeOptionalInt(start_offset);
    const endOffsetParsed =
        end_offset === null ? null : normalizeOptionalInt(end_offset);

    if (
        Number.isNaN(startOffsetParsed) ||
        Number.isNaN(endOffsetParsed) ||
        (startOffsetParsed !== undefined && startOffsetParsed !== null && startOffsetParsed < 0) ||
        (endOffsetParsed !== undefined && endOffsetParsed !== null && endOffsetParsed < 0) ||
        (startOffsetParsed !== undefined &&
            startOffsetParsed !== null &&
            endOffsetParsed !== undefined &&
            endOffsetParsed !== null &&
            endOffsetParsed < startOffsetParsed)
    ) {
        return res.status(400).json({
            error:
                "Invalid body. start_offset/end_offset must be integers where end_offset >= start_offset >= 0.",
        });
    }

    const rawSelectedText =
        typeof raw_selected_text === "string"
            ? raw_selected_text
            : typeof selected_text === "string"
                ? selected_text
                : "";
    const formattedSelectedText =
        typeof formatted_selected_text === "string"
            ? formatted_selected_text
            : formatted_selected_text === null
                ? null
                : null;

    if (!rawSelectedText.trim()) {
        return res.status(400).json({
            error: "Invalid body. raw_selected_text must be a non-empty string.",
        });
    }

    const selectedTextToStore =
        typeof selected_text === "string" && selected_text.trim()
            ? selected_text
            : formattedSelectedText && formattedSelectedText.trim()
                ? formattedSelectedText
                : rawSelectedText;

    const tagsNorm = normalizeTags(tags);
    if (tagsNorm === "__INVALID__") {
        return res.status(400).json({
            error: "Invalid body. tags must be an array of strings or comma-separated string.",
        });
    }

    if (
        (scene_label !== undefined && scene_label !== null && typeof scene_label !== "string") ||
        (scene_summary !== undefined && scene_summary !== null && typeof scene_summary !== "string")
    ) {
        return res.status(400).json({
            error: "Invalid body. scene_label/scene_summary must be strings when provided.",
        });
    }

    const anchorGeometryNorm = normalizeAnchorGeometry(anchor_geometry);
    if (anchorGeometryNorm === "__INVALID__") {
        return res.status(400).json({
            error: "Invalid body. anchor_geometry must be a JSON array when provided.",
        });
    }

    try {
        const scriptCheck = await pool.query(`SELECT id FROM scripts WHERE id = $1 AND movie_id = $2`, [
            scriptId,
            movieId,
        ]);
        if (scriptCheck.rows.length === 0) return res.status(404).json({ error: "Script not found" });

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const conflictingRow = await findOverlappingScriptScene(client, {
                movieId,
                scriptId,
                startTimeSeconds: startTime,
                endTimeSeconds: endTime,
            });
            if (conflictingRow) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    error: "Scene time range overlaps an existing scene in this script.",
                    conflict_scene_id: conflictingRow.id,
                    conflict_start_time_seconds: conflictingRow.start_time_seconds,
                    conflict_end_time_seconds: conflictingRow.end_time_seconds,
                });
            }

            const anchorId = uuidv4();
            const sceneId = uuidv4();

            await client.query(
                `
                INSERT INTO script_scene_anchors (
                  id,
                  movie_id,
                  script_id,
                  page_start,
                  page_end,
                  selected_text,
                  raw_selected_text,
                  formatted_selected_text,
                  context_prefix,
                  context_suffix,
                  start_offset,
                  end_offset,
                  anchor_geometry
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8,
                  $9, $10, $11, $12, $13::jsonb
                )
              `,
                [
                    anchorId,
                    movieId,
                    scriptId,
                    pageStartParsed === undefined ? null : pageStartParsed,
                    pageEndParsed === undefined ? null : pageEndParsed,
                    selectedTextToStore,
                    rawSelectedText,
                    formattedSelectedText,
                    context_prefix === undefined ? null : context_prefix,
                    context_suffix === undefined ? null : context_suffix,
                    startOffsetParsed === undefined ? null : startOffsetParsed,
                    endOffsetParsed === undefined ? null : endOffsetParsed,
                    JSON.stringify(anchorGeometryNorm === undefined ? [] : anchorGeometryNorm),
                ]
            );

            await client.query(
                `
                INSERT INTO script_scene_annotations (
                  id,
                  anchor_id,
                  movie_id,
                  script_id,
                  start_time_seconds,
                  end_time_seconds,
                  tags,
                  scene_label,
                  scene_summary
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
              `,
                [
                    sceneId,
                    anchorId,
                    movieId,
                    scriptId,
                    startTime,
                    endTime,
                    JSON.stringify(tagsNorm === undefined ? [] : tagsNorm),
                    typeof scene_label === "string" && scene_label.trim() ? scene_label.trim() : null,
                    typeof scene_summary === "string" && scene_summary.trim()
                        ? scene_summary.trim()
                        : null,
                ]
            );

            const createdRow = await fetchScriptSceneRow(client, {
                sceneId,
                movieId,
                scriptId,
            });

            await client.query("COMMIT");
            return res.status(201).json(mapScriptSceneRow(createdRow));
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("POST script scene annotation error:", err);
        return res.status(500).json({ error: "Failed to create script scene annotation" });
    }
}

async function listScriptScenes(req, res) {
    const { movieId, scriptId } = req.params;
    const rawTags = Array.isArray(req.query.tags) ? req.query.tags.join(",") : req.query.tags;
    const tagsNorm = normalizeTags(rawTags);
    const match = req.query.match === "any" ? "any" : "all";

    if (tagsNorm === "__INVALID__") {
        return res.status(400).json({ error: "Invalid tags query parameter." });
    }

    const values = [movieId, scriptId];
    const where = [`sc.movie_id = $1`, `sc.script_id = $2`];

    if (tagsNorm && tagsNorm.length > 0) {
        if (match === "any") {
            values.push(tagsNorm);
            where.push(`sc.tags ?| $${values.length}::text[]`);
        } else {
            values.push(JSON.stringify(tagsNorm));
            where.push(`sc.tags @> $${values.length}::jsonb`);
        }
    }

    try {
        const result = await pool.query(
            `
            ${SCRIPT_SCENE_SELECT_SQL}
            WHERE ${where.join(" AND ")}
            ORDER BY COALESCE(a.page_start, 2147483647) ASC, sc.start_time_seconds ASC, sc.created_at ASC
          `,
            values
        );

        return res.json(result.rows.map(mapScriptSceneRow));
    } catch (err) {
        console.error("GET script scene annotations error:", err);
        return res.status(500).json({ error: "Failed to fetch script scene annotations" });
    }
}

async function updateScriptScene(req, res) {
    const { movieId, scriptId } = req.params;
    const sceneId = getScriptSceneIdFromParams(req.params);
    const body = req.body || {};

    if (!sceneId) {
        return res.status(400).json({ error: "Missing scene annotation id." });
    }

    try {
        const existingRow = await fetchScriptSceneRow(pool, { sceneId, movieId, scriptId });
        if (!existingRow) {
            return res.status(404).json({ error: "Script scene annotation not found" });
        }

        const startTimeParsed = normalizeOptionalInt(body.start_time_seconds);
        const endTimeParsed = normalizeOptionalInt(body.end_time_seconds);
        if (Number.isNaN(startTimeParsed) || Number.isNaN(endTimeParsed)) {
            return res.status(400).json({
                error: "start_time_seconds/end_time_seconds must be integers when provided.",
            });
        }

        const nextStartTime =
            startTimeParsed === undefined ? existingRow.start_time_seconds : startTimeParsed;
        const nextEndTime =
            endTimeParsed === undefined ? existingRow.end_time_seconds : endTimeParsed;
        if (!isFiniteInt(nextStartTime) || !isFiniteInt(nextEndTime) || nextStartTime < 0 || nextEndTime < nextStartTime) {
            return res.status(400).json({
                error: "Invalid time range. end_time_seconds must be >= start_time_seconds >= 0.",
            });
        }

        const pageStartParsed =
            body.page_start === undefined
                ? undefined
                : body.page_start === null
                    ? null
                    : normalizeOptionalInt(body.page_start);
        const pageEndParsed =
            body.page_end === undefined
                ? undefined
                : body.page_end === null
                    ? null
                    : normalizeOptionalInt(body.page_end);
        if (Number.isNaN(pageStartParsed) || Number.isNaN(pageEndParsed)) {
            return res.status(400).json({
                error: "page_start/page_end must be integers when provided.",
            });
        }
        const nextPageStart = pageStartParsed === undefined ? existingRow.page_start : pageStartParsed;
        const nextPageEnd = pageEndParsed === undefined ? existingRow.page_end : pageEndParsed;
        if (
            (nextPageStart !== null && nextPageStart !== undefined && nextPageStart < 1) ||
            (nextPageEnd !== null && nextPageEnd !== undefined && nextPageEnd < 1) ||
            (nextPageStart !== null &&
                nextPageStart !== undefined &&
                nextPageEnd !== null &&
                nextPageEnd !== undefined &&
                nextPageEnd < nextPageStart)
        ) {
            return res.status(400).json({
                error: "Invalid page range. page_start/page_end must be positive and page_end >= page_start.",
            });
        }

        const startOffsetParsed =
            body.start_offset === undefined
                ? undefined
                : body.start_offset === null
                    ? null
                    : normalizeOptionalInt(body.start_offset);
        const endOffsetParsed =
            body.end_offset === undefined
                ? undefined
                : body.end_offset === null
                    ? null
                    : normalizeOptionalInt(body.end_offset);
        if (Number.isNaN(startOffsetParsed) || Number.isNaN(endOffsetParsed)) {
            return res.status(400).json({
                error: "start_offset/end_offset must be integers when provided.",
            });
        }
        const nextStartOffset =
            startOffsetParsed === undefined ? existingRow.start_offset : startOffsetParsed;
        const nextEndOffset =
            endOffsetParsed === undefined ? existingRow.end_offset : endOffsetParsed;
        if (
            (nextStartOffset !== null && nextStartOffset !== undefined && nextStartOffset < 0) ||
            (nextEndOffset !== null && nextEndOffset !== undefined && nextEndOffset < 0) ||
            (nextStartOffset !== null &&
                nextStartOffset !== undefined &&
                nextEndOffset !== null &&
                nextEndOffset !== undefined &&
                nextEndOffset < nextStartOffset)
        ) {
            return res.status(400).json({
                error:
                    "Invalid offsets. start_offset/end_offset must be >= 0 and end_offset >= start_offset.",
            });
        }

        if (
            (body.selected_text !== undefined && body.selected_text !== null && typeof body.selected_text !== "string") ||
            (body.raw_selected_text !== undefined &&
                body.raw_selected_text !== null &&
                typeof body.raw_selected_text !== "string") ||
            (body.formatted_selected_text !== undefined &&
                body.formatted_selected_text !== null &&
                typeof body.formatted_selected_text !== "string") ||
            (body.context_prefix !== undefined &&
                body.context_prefix !== null &&
                typeof body.context_prefix !== "string") ||
            (body.context_suffix !== undefined &&
                body.context_suffix !== null &&
                typeof body.context_suffix !== "string") ||
            (body.scene_label !== undefined && body.scene_label !== null && typeof body.scene_label !== "string") ||
            (body.scene_summary !== undefined &&
                body.scene_summary !== null &&
                typeof body.scene_summary !== "string")
        ) {
            return res.status(400).json({
                error:
                    "Invalid body. Text fields must be strings when provided (or null where supported).",
            });
        }

        const tagsNorm = body.tags === undefined ? undefined : normalizeTags(body.tags);
        if (tagsNorm === "__INVALID__") {
            return res.status(400).json({
                error: "Invalid body. tags must be an array of strings or comma-separated string.",
            });
        }

        const anchorGeometryNorm =
            body.anchor_geometry === undefined
                ? undefined
                : normalizeAnchorGeometry(body.anchor_geometry);
        if (anchorGeometryNorm === "__INVALID__") {
            return res.status(400).json({
                error: "Invalid body. anchor_geometry must be a JSON array when provided.",
            });
        }

        const nextRawSelectedText =
            body.raw_selected_text === undefined
                ? existingRow.raw_selected_text
                : body.raw_selected_text === null
                    ? ""
                    : body.raw_selected_text;
        const nextFormattedSelectedText =
            body.formatted_selected_text === undefined
                ? existingRow.formatted_selected_text
                : body.formatted_selected_text;
        const selectedTextCandidate =
            body.selected_text === undefined
                ? existingRow.selected_text
                : body.selected_text === null
                    ? ""
                    : body.selected_text;
        const nextSelectedText =
            typeof selectedTextCandidate === "string" && selectedTextCandidate.trim()
                ? selectedTextCandidate
                : typeof nextFormattedSelectedText === "string" && nextFormattedSelectedText.trim()
                    ? nextFormattedSelectedText
                    : nextRawSelectedText;

        if (!nextRawSelectedText.trim()) {
            return res.status(400).json({
                error: "raw_selected_text must remain a non-empty string.",
            });
        }

        const nextContextPrefix =
            body.context_prefix === undefined ? existingRow.context_prefix : body.context_prefix;
        const nextContextSuffix =
            body.context_suffix === undefined ? existingRow.context_suffix : body.context_suffix;
        const nextSceneLabel =
            body.scene_label === undefined
                ? existingRow.scene_label
                : body.scene_label && body.scene_label.trim()
                    ? body.scene_label.trim()
                    : null;
        const nextSceneSummary =
            body.scene_summary === undefined
                ? existingRow.scene_summary
                : body.scene_summary && body.scene_summary.trim()
                    ? body.scene_summary.trim()
                    : null;
        const nextTags = tagsNorm === undefined ? existingRow.tags : tagsNorm;
        const nextAnchorGeometry =
            anchorGeometryNorm === undefined ? existingRow.anchor_geometry : anchorGeometryNorm;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const conflictingRow = await findOverlappingScriptScene(client, {
                movieId,
                scriptId,
                startTimeSeconds: nextStartTime,
                endTimeSeconds: nextEndTime,
                excludeSceneId: sceneId,
            });
            if (conflictingRow) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    error: "Scene time range overlaps an existing scene in this script.",
                    conflict_scene_id: conflictingRow.id,
                    conflict_start_time_seconds: conflictingRow.start_time_seconds,
                    conflict_end_time_seconds: conflictingRow.end_time_seconds,
                });
            }

            await client.query(
                `
                UPDATE script_scene_anchors
                SET
                  page_start = $2,
                  page_end = $3,
                  selected_text = $4,
                  raw_selected_text = $5,
                  formatted_selected_text = $6,
                  context_prefix = $7,
                  context_suffix = $8,
                  start_offset = $9,
                  end_offset = $10,
                  anchor_geometry = $11::jsonb,
                  updated_at = NOW()
                WHERE id = $1
              `,
                [
                    existingRow.anchor_id,
                    nextPageStart ?? null,
                    nextPageEnd ?? null,
                    nextSelectedText,
                    nextRawSelectedText,
                    nextFormattedSelectedText ?? null,
                    nextContextPrefix ?? null,
                    nextContextSuffix ?? null,
                    nextStartOffset ?? null,
                    nextEndOffset ?? null,
                    JSON.stringify(Array.isArray(nextAnchorGeometry) ? nextAnchorGeometry : []),
                ]
            );

            await client.query(
                `
                UPDATE script_scene_annotations
                SET
                  start_time_seconds = $2,
                  end_time_seconds = $3,
                  tags = $4::jsonb,
                  scene_label = $5,
                  scene_summary = $6,
                  updated_at = NOW()
                WHERE id = $1
              `,
                [
                    sceneId,
                    nextStartTime,
                    nextEndTime,
                    JSON.stringify(Array.isArray(nextTags) ? nextTags : []),
                    nextSceneLabel,
                    nextSceneSummary,
                ]
            );

            const updatedRow = await fetchScriptSceneRow(client, { sceneId, movieId, scriptId });
            await client.query("COMMIT");
            return res.json(mapScriptSceneRow(updatedRow));
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("PUT script scene annotation error:", err);
        return res.status(500).json({ error: "Failed to update script scene annotation" });
    }
}

async function deleteScriptScene(req, res) {
    const { movieId, scriptId } = req.params;
    const sceneId = getScriptSceneIdFromParams(req.params);

    if (!sceneId) {
        return res.status(400).json({ error: "Missing scene annotation id." });
    }

    try {
        const result = await pool.query(
            `
            DELETE FROM script_scene_anchors a
            USING script_scene_annotations sc
            WHERE sc.anchor_id = a.id
              AND sc.id = $1
              AND sc.movie_id = $2
              AND sc.script_id = $3
            RETURNING sc.id
          `,
            [sceneId, movieId, scriptId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Script scene annotation not found" });
        }
        return res.status(204).send();
    } catch (err) {
        console.error("DELETE script scene annotation error:", err);
        return res.status(500).json({ error: "Failed to delete script scene annotation" });
    }
}

async function searchScriptScenes(req, res) {
    const rawTags = Array.isArray(req.query.tags) ? req.query.tags.join(",") : req.query.tags;
    const tagsNorm = normalizeTags(rawTags);
    const match = req.query.match === "any" ? "any" : "all";
    const movieId = typeof req.query.movie_id === "string" ? req.query.movie_id : null;
    const scriptId = typeof req.query.script_id === "string" ? req.query.script_id : null;
    const queryText = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (tagsNorm === "__INVALID__") {
        return res.status(400).json({ error: "Invalid tags query parameter." });
    }

    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(1000, rawLimit)) : 500;

    const values = [];
    const where = [];

    if (movieId) {
        values.push(movieId);
        where.push(`sc.movie_id = $${values.length}`);
    }
    if (scriptId) {
        values.push(scriptId);
        where.push(`sc.script_id = $${values.length}`);
    }

    if (tagsNorm && tagsNorm.length > 0) {
        if (match === "any") {
            values.push(tagsNorm);
            where.push(`sc.tags ?| $${values.length}::text[]`);
        } else {
            values.push(JSON.stringify(tagsNorm));
            where.push(`sc.tags @> $${values.length}::jsonb`);
        }
    }

    if (queryText) {
        values.push(`%${queryText}%`);
        const textParam = `$${values.length}`;
        where.push(
            `(
              sc.scene_label ILIKE ${textParam}
              OR sc.scene_summary ILIKE ${textParam}
              OR a.selected_text ILIKE ${textParam}
              OR COALESCE(a.formatted_selected_text, '') ILIKE ${textParam}
              OR COALESCE(a.raw_selected_text, '') ILIKE ${textParam}
            )`
        );
    }

    values.push(limit);
    const limitParam = `$${values.length}`;

    try {
        const result = await pool.query(
            `
            SELECT
${SCRIPT_SCENE_SELECT_FIELDS_SQL},
              m.title AS movie_title,
              s.s3_key
            ${SCRIPT_SCENE_FROM_SQL}
            JOIN movies m ON m.id = sc.movie_id
            JOIN scripts s ON s.id = sc.script_id
            ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
            ORDER BY sc.updated_at DESC
            LIMIT ${limitParam}
          `,
            values
        );

        const urlCache = new Map();
        const rowsWithUrls = await Promise.all(
            result.rows.map(async (row) => {
                if (!row.s3_key) return { ...row, script_url: null };
                if (urlCache.has(row.s3_key)) return { ...row, script_url: urlCache.get(row.s3_key) };
                try {
                    const { url } = await createPresignedGetUrl({ key: row.s3_key });
                    urlCache.set(row.s3_key, url);
                    return { ...row, script_url: url };
                } catch {
                    return { ...row, script_url: null };
                }
            })
        );

        return res.json(rowsWithUrls.map(mapScriptSceneRow));
    } catch (err) {
        console.error("GET script scene search error:", err);
        return res.status(500).json({ error: "Failed to search script scene annotations" });
    }
}

const scriptSceneCollectionRoutes = [
    "/movies/:movieId/scripts/:scriptId/scene-annotations",
    "/movies/:movieId/scripts/:scriptId/annotations",
];

for (const route of scriptSceneCollectionRoutes) {
    app.post(route, createScriptScene);
    app.get(route, listScriptScenes);
}

const scriptSceneItemRoutes = [
    "/movies/:movieId/scripts/:scriptId/scene-annotations/:sceneId",
    "/movies/:movieId/scripts/:scriptId/annotations/:annotationId",
];

for (const route of scriptSceneItemRoutes) {
    app.put(route, updateScriptScene);
    app.delete(route, deleteScriptScene);
}

app.get("/script-scenes", searchScriptScenes);
app.get("/script-annotations", searchScriptScenes);

/**
 * Uploads
 * - POST /uploads/presign
 * - GET /uploads/view-url?key=...
 */

app.post("/uploads/presign", async (req, res) => {
    const { movieId, type, contentType } = req.body;
    const isImageUpload = type === "cover" || type === "annotation";
    const isScriptUpload = type === "script";

    if (
        typeof movieId !== "string" ||
        (!isImageUpload && !isScriptUpload) ||
        typeof contentType !== "string" ||
        (isImageUpload && !contentType.startsWith("image/")) ||
        (isScriptUpload && contentType !== "application/pdf")
    ) {
        return res.status(400).json({
            error:
                'Invalid body. Expected { movieId:string, type:"cover"|"annotation"|"script", contentType:"image/*"| "application/pdf" }',
        });
    }

    const id = uuidv4();
    const ext = getExtensionForContentType(contentType);
    const key = buildObjectKey({
        movieId,
        type,
        filename: `${id}.${ext}`,
    });

    try {
        const { uploadUrl } = await createPresignedPutUrl({ key, contentType });
        return res.json({ uploadUrl, key });
    } catch (err) {
        console.error("POST /uploads/presign error:", err?.name, err?.message);
        console.error(err);
        return res.status(500).json({ error: "Failed to presign upload" });
    }
});

app.get("/uploads/view-url", async (req, res) => {
    const key = req.query.key;

    if (typeof key !== "string" || key.length < 3) {
        return res.status(400).json({ error: "Missing or invalid key" });
    }

    if (!key.startsWith("covers/") && !key.startsWith("annotations/") && !key.startsWith("scripts/")) {
        return res.status(400).json({ error: "Invalid key prefix" });
    }

    try {
        const { url } = await createPresignedGetUrl({ key });
        return res.json({ url });
    } catch (err) {
        console.error("GET /uploads/view-url error:", err);
        return res.status(500).json({ error: "Failed to generate view URL" });
    }
});

app.listen(process.env.PORT || 4000, () => {
    console.log("ShotDeck API running on port", process.env.PORT || 4000);
});
