import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { v4 as uuidv4 } from "uuid";
import "./env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, "../sql/schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");
await pool.query(sql);
await pool.query(`
  ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb
`);
await pool.query(`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'script_annotations'
    ) THEN
      ALTER TABLE script_annotations
      ADD COLUMN IF NOT EXISTS raw_selected_text TEXT;

      ALTER TABLE script_annotations
      ADD COLUMN IF NOT EXISTS formatted_selected_text TEXT;

      UPDATE script_annotations
      SET raw_selected_text = COALESCE(raw_selected_text, selected_text, '')
      WHERE raw_selected_text IS NULL;

      ALTER TABLE script_annotations
      ALTER COLUMN raw_selected_text SET NOT NULL;
    END IF;
  END $$;
`);

await pool.query(`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'script_scene_anchors'
    ) THEN
      ALTER TABLE script_scene_anchors
      ADD COLUMN IF NOT EXISTS anchor_geometry JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'script_scene_annotations'
    ) THEN
      ALTER TABLE script_scene_annotations
      ADD COLUMN IF NOT EXISTS legacy_annotation_id UUID UNIQUE;

      ALTER TABLE script_scene_annotations
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
  END $$;
`);

const legacyTableExistsResult = await pool.query(`
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'script_annotations'
  ) AS exists
`);

if (legacyTableExistsResult.rows[0]?.exists) {
  const legacyRows = await pool.query(`
    SELECT sa.*
    FROM script_annotations sa
    LEFT JOIN script_scene_annotations ssa ON ssa.legacy_annotation_id = sa.id
    WHERE ssa.id IS NULL
    ORDER BY sa.created_at ASC
  `);

  if (legacyRows.rows.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const row of legacyRows.rows) {
        const rawSelectedText =
          typeof row.raw_selected_text === "string" && row.raw_selected_text.length > 0
            ? row.raw_selected_text
            : typeof row.selected_text === "string"
              ? row.selected_text
              : "";
        const formattedSelectedText =
          typeof row.formatted_selected_text === "string" && row.formatted_selected_text.length > 0
            ? row.formatted_selected_text
            : null;
        const selectedText =
          typeof row.selected_text === "string" && row.selected_text.length > 0
            ? row.selected_text
            : formattedSelectedText || rawSelectedText;

        if (!rawSelectedText.trim()) {
          continue;
        }

        const anchorId = uuidv4();
        const sceneId = uuidv4();
        const tags = Array.isArray(row.tags) ? row.tags : [];

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
              anchor_geometry,
              created_at,
              updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              NULL, NULL, NULL, NULL, '[]'::jsonb, $9, $9
            )
          `,
          [
            anchorId,
            row.movie_id,
            row.script_id,
            row.page_start ?? null,
            row.page_end ?? null,
            selectedText,
            rawSelectedText,
            formattedSelectedText,
            row.created_at,
          ]
        );

        await client.query(
          `
            INSERT INTO script_scene_annotations (
              id,
              anchor_id,
              legacy_annotation_id,
              movie_id,
              script_id,
              start_time_seconds,
              end_time_seconds,
              tags,
              created_at,
              updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
              $9, $9
            )
          `,
          [
            sceneId,
            anchorId,
            row.id,
            row.movie_id,
            row.script_id,
            row.start_time_seconds,
            row.end_time_seconds,
            JSON.stringify(tags),
            row.created_at,
          ]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

console.log("Schema applied.");
await pool.end();
