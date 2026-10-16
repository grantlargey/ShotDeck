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
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  min: 3,
  idleTimeoutMillis: 60_000,
  keepAlive: true,
});

pool.on("error", (err) => {
  console.error("Idle database connection error:", err.message);
});

/** Runs `work` in one transaction, rolling back and rethrowing if it throws. */
export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
