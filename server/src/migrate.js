import fs from "fs";
import path from "path";
import { pool } from "./db.js";

const sql = fs.readFileSync(path.join("sql", "schema.sql"), "utf8");
await pool.query(sql);
await pool.query(`
  ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb
`);
console.log("Schema applied.");
await pool.end();
