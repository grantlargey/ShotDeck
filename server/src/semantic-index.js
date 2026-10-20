import { pool } from "./db.js";
import { indexScenes } from "./services/semantic-search.service.js";

/*
 * Builds or refreshes the semantic scene index. Run after adding a Gemini key
 * and after adding or editing captured scenes:
 *
 *   npm run semantic:index
 *
 * Scenes whose text, tags and embedding model already match are skipped, so
 * running it again is cheap and safe.
 */
try {
    const result = await indexScenes(pool);
    console.log(
        `Semantic index ready (${result.model}): ${result.indexed_count} scene(s) embedded, ` +
            `${result.current_count} already current, ${result.total_count} total.`
    );
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
