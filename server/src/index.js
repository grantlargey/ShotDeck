// server/src/index.js
import express from "express";
import cors from "cors";
import "dotenv/config";

import { pool } from "./db.js";
import { v4 as uuidv4 } from "uuid";
import { createPresignedPutUrl, createPresignedGetUrl } from "./s3.js";

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" })); // metadata only; no big file uploads

app.get("/health", (req, res) => res.json({ ok: true }));

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

async function withMovieCoverUrl(movieRow) {
    if (!movieRow) return movieRow;
    if (!movieRow.cover_image_key) return { ...movieRow, cover_image_url: null };

    const { url } = await createPresignedGetUrl({ key: movieRow.cover_image_key });
    return { ...movieRow, cover_image_url: url };
}

async function withAnnotationImageUrl(row) {
    if (!row) return row;
    if (!row.image_key) return { ...row, image_url: null };

    const { url } = await createPresignedGetUrl({ key: row.image_key });
    return { ...row, image_url: url };
}

/**
 * Movies
 * - POST /movies
 * - GET  /movies
 * - GET  /movies/:id
 * - PUT  /movies/:id
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
        return res.status(500).json({ error: "Failed to create movie" });
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
        return res.status(500).json({ error: "Failed to fetch movies" });
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

    const id = uuidv4();

    try {
        const movieCheck = await pool.query(`SELECT id FROM movies WHERE id = $1`, [movieId]);
        if (movieCheck.rows.length === 0) return res.status(404).json({ error: "Movie not found" });

        const result = await pool.query(
            `
        INSERT INTO annotations (id, movie_id, time_seconds, title, body, image_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
            [id, movieId, time_seconds, title, body ?? null, image_key ?? null]
        );

        const row = await withAnnotationImageUrl(result.rows[0]);
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
        const { title, body, image_key } = req.body || {};

        if (typeof title !== "string" || typeof body !== "string") {
            return res.status(400).json({ error: "title and body are required" });
        }

        const q = `
        UPDATE annotations
        SET title = $1,
            body = $2,
            image_key = $3
        WHERE id = $4 AND movie_id = $5
        RETURNING *
      `;

        const result = await pool.query(q, [
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
 * Uploads
 * - POST /uploads/presign
 * - GET /uploads/view-url?key=...
 */

app.post("/uploads/presign", async (req, res) => {
    const { movieId, type, contentType } = req.body;

    if (
        typeof movieId !== "string" ||
        (type !== "cover" && type !== "annotation") ||
        typeof contentType !== "string" ||
        !contentType.startsWith("image/")
    ) {
        return res.status(400).json({
            error:
                'Invalid body. Expected { movieId:string, type:"cover"|"annotation", contentType:"image/*" }',
        });
    }

    const ext =
        contentType === "image/png"
            ? "png"
            : contentType === "image/webp"
                ? "webp"
                : contentType === "image/jpeg"
                    ? "jpg"
                    : contentType === "image/gif"
                        ? "gif"
                        : contentType === "image/avif"
                            ? "avif"
                            : "jpg";

    const id = uuidv4();
    const key =
        type === "cover" ? `covers/${movieId}/${id}.${ext}` : `annotations/${movieId}/${id}.${ext}`;

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

    if (!key.startsWith("covers/") && !key.startsWith("annotations/")) {
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