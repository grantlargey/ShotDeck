/*
 * Loaded before any server module (helpers/api.js imports it first). It refuses
 * to run against anything but a throwaway test database, and stops server code
 * from reaching any host except this machine through fetch, such as OpenAI.
 */
let databaseName = "";
try {
    databaseName = new URL(process.env.DATABASE_URL || "").pathname.slice(1);
} catch {
    // Reported below.
}
if (!databaseName.startsWith("shotdeck_test_")) {
    throw new Error("Server tests only run against a shotdeck_test_* database. Run them with `npm test --prefix server`.");
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(`Server tests may not contact ${url.host}.`);
    return realFetch(input, init);
};
