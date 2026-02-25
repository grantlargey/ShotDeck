import fs from "fs";
import path from "path";
import { pool } from "./db.js";

const sql = fs.readFileSync(path.join("sql", "schema.sql"), "utf8");
await pool.query(sql);
console.log("Schema applied.");
await pool.end();