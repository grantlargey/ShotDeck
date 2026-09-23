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
  // A page load runs a few queries at once, so keep that many connections open.
  // Idle connections used to close after 10 seconds, and reopening TLS
  // connections to RDS slowed the first load after a quiet spell. Extra
  // connections still close after a minute.
  min: 3,
  idleTimeoutMillis: 60_000,
  keepAlive: true,
});

// A long-idle connection can drop (for example when RDS restarts). Log it rather
// than letting the pool's unhandled error event crash the API.
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
