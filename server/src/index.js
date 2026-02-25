// server/src/index.js
import express from "express";
import cors from "cors";
import "dotenv/config";

import { pool } from "./db.js";
import { v4 as uuidv4 } from "uuid";
import {
    createPresignedPutUrl,
    createPresignedGetUrl,
    buildPublicUrlForKey,
} from "./s3.js";

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" })); // metadata only; no big file uploads

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Movies
 * - POST /movies
 * - GET  /movies
 * - GET  /movies/:id
 */

// Create a movie
app.post("/movies", async (req, res) => {
    const { title, director, year, runtime_minutes, cover_image_key } = req.body;

    // Basic validation (keep it minimal; you can replace with zod later)
    if (
        typeof title !== "string" ||
        typeof director !== "string" ||
        typeof year !== "number" ||
        typeof runtime_minutes !== "number"
    ) {
        return res.status(400).json({
            error:
                "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) cover_image_key:string }",
        });
    }

    const id = uuidv4();

    try {
        const result = await pool.query(
            `
      INSERT INTO movies (id, title, director, year, runtime_minutes, cover_image_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
            [id, title, director, year, runtime_minutes, cover_image_key ?? null]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("POST /movies error:", err);
        return res.status(500).json({ error: "Failed to create movie" });
    }
});

// List all movies
app.get("/movies", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM movies ORDER BY created_at DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error("GET /movies error:", err);
        return res.status(500).json({ error: "Failed to fetch movies" });
    }
});

// Get one movie by id
app.get("/movies/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(`SELECT * FROM movies WHERE id = $1`, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Movie not found" });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error("GET /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to fetch movie" });
    }
});

// Update a movie
app.put("/movies/:id", async (req, res) => {
    const { id } = req.params;
    const { title, director, year, runtime_minutes, cover_image_key } = req.body;

    if (
        typeof title !== "string" ||
        typeof director !== "string" ||
        typeof year !== "number" ||
        typeof runtime_minutes !== "number"
    ) {
        return res.status(400).json({
            error:
                "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) cover_image_key:string }",
        });
    }

    try {
        const result = await pool.query(
            `
        UPDATE movies
        SET title = $2,
            director = $3,
            year = $4,
            runtime_minutes = $5,
            cover_image_key = $6
        WHERE id = $1
        RETURNING *
        `,
            [id, title, director, year, runtime_minutes, cover_image_key ?? null]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Movie not found" });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error("PUT /movies/:id error:", err);
        return res.status(500).json({ error: "Failed to update movie" });
    }
});

/**
 * Annotations
 * - POST /movies/:id/annotations
 * - GET  /movies/:id/annotations
 */

// Create an annotation for a movie
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
        // (Optional) Ensure movie exists; helps return a clean 404 instead of a FK error
        const movieCheck = await pool.query(`SELECT id FROM movies WHERE id = $1`, [
            movieId,
        ]);
        if (movieCheck.rows.length === 0) {
            return res.status(404).json({ error: "Movie not found" });
        }

        const result = await pool.query(
            `
      INSERT INTO annotations (id, movie_id, time_seconds, title, body, image_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
            [
                id,
                movieId,
                time_seconds,
                title,
                body ?? null,
                image_key ?? null,
            ]
        );

        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("POST /movies/:id/annotations error:", err);
        return res.status(500).json({ error: "Failed to create annotation" });
    }
});

// List annotations for a movie (ordered by timestamp)
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

        return res.json(result.rows);
    } catch (err) {
        console.error("GET /movies/:id/annotations error:", err);
        return res.status(500).json({ error: "Failed to fetch annotations" });
    }
});

// Delete an annotation
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

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Annotation not found" });
        }

        return res.status(204).send();
    } catch (err) {
        console.error("DELETE /movies/:movieId/annotations/:annotationId error:", err);
        return res.status(500).json({ error: "Failed to delete annotation" });
    }
});

/**
 * Uploads
 * - POST /uploads/presign
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

    // Basic extension mapping
    const ext =
        contentType === "image/png"
            ? "png"
            : contentType === "image/webp"
                ? "webp"
                : contentType === "image/jpeg"
                    ? "jpg"
                    : "jpg";

    const id = uuidv4();
    const key =
        type === "cover"
            ? `covers/${movieId}/${id}.${ext}`
            : `annotations/${movieId}/${id}.${ext}`;

    try {
        const { uploadUrl } = await createPresignedPutUrl({ key, contentType });
        const publicUrl = buildPublicUrlForKey(key);

        return res.json({ uploadUrl, key, publicUrl });
    } catch (err) {
        console.error("POST /uploads/presign error:", err);
        return res.status(500).json({ error: "Failed to presign upload" });
    }
});

/**
* Upload viewing (private bucket)
* - GET /uploads/view-url?key=...
*/
app.get("/uploads/view-url", async (req, res) => {
    const key = req.query.key;

    if (typeof key !== "string" || key.length < 3) {
        return res.status(400).json({ error: "Missing or invalid key" });
    }

    // Basic safety: only allow your expected prefixes
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

// Start server
app.listen(process.env.PORT || 4000, () => {
    console.log("ShotDeck API running on port", process.env.PORT || 4000);
});