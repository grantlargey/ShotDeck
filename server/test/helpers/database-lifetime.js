import pg from "pg";

/** One test run's databases. Only acknowledged creations belong to this run.
 * withAdmin supplies a query function while its administrative connection is open.
 * Borrowed databases never enter this lifetime: callers use them without create().
 */
export function createTestDatabases(withAdmin) {
    const owned = new Set();
    const pending = new Set();
    let cleanupPromise;

    return {
        async create(name) {
            if (cleanupPromise) throw new Error("Test database cleanup has already started.");
            // PostgreSQL truncates identifiers beyond 63 bytes. Refuse rather
            // than accidentally acquiring or deleting a different database.
            if (!/^scriptdeck_test_[a-z0-9_]+$/.test(name) || name.length > 63) {
                throw new Error(`Refusing unsafe test database name: ${name}`);
            }
            const operation = withAdmin(async (query) => {
                await query(`CREATE DATABASE ${name}`);
                // Record this before closing the connection, which can fail too.
                owned.add(name);
            });
            pending.add(operation);
            try {
                await operation;
            } finally {
                pending.delete(operation);
            }
        },
        cleanup() {
            cleanupPromise ??= (async () => {
                await Promise.allSettled([...pending]);
                const errors = [];
                for (const name of [...owned].reverse()) {
                    try {
                        await withAdmin(async (query) => {
                            await query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
                            owned.delete(name);
                        });
                    } catch (cause) {
                        errors.push(new Error(`Could not clean up test database ${name}: ${cause.message}`, { cause }));
                    }
                }
                if (errors.length) throw new AggregateError(errors, "Test database cleanup failed.");
            })();
            return cleanupPromise;
        },
    };
}

/** Shared PostgreSQL adapter for migration tests and browser smoke. */
export function postgresAdmin(connectionString) {
    const url = new URL(connectionString);
    url.pathname = "/postgres";
    url.search = "";
    return async (work) => {
        const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5_000 });
        try {
            await client.connect();
            return await work((sql) => client.query(sql));
        } finally {
            await client.end();
        }
    };
}
