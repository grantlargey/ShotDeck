import pg from "pg";
import "./env.js";

const connectionString = process.env.DATABASE_URL;
const useSsl =
  typeof connectionString === "string" &&
  connectionString.includes("rds.amazonaws.com");

if (!connectionString) {
  console.warn("DATABASE_URL is not set. Configure it in server/.env or shell environment.");
}

export const pool = new pg.Pool({
  connectionString,
  // RDS commonly requires TLS; local Docker/localhost should stay non-SSL.
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});
