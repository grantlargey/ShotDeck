import pg from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
const useSsl =
  typeof connectionString === "string" &&
  connectionString.includes("rds.amazonaws.com");

export const pool = new pg.Pool({
  connectionString,
  // RDS commonly requires TLS; local Docker/localhost should stay non-SSL.
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});
