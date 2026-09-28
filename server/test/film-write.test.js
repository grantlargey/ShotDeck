import "./helpers/guard.js";
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { pool } from "../src/db.js";
import { withFilmWrite } from "../src/services/filmWrite.js";
import { HttpError } from "../src/utils/http-error.js";

/*
 * The captured-PDF contract of withFilmWrite, read at the interface rather than
 * through an endpoint. The statements are what matters here — which rows a write
 * locks, and which answer each kind of scriptKey earns — so these tests stand a
 * recording Pool where a real one goes. What the SQL does to real rows is pinned
 * over HTTP by captured-scenes.write.test.js.
 */

// The module's own Pool is built when ../src/db.js loads. Nothing here connects
// through it; closing it keeps the test process from holding a pool open.
after(() => pool.end());

const MOVIE_ID = "11111111-1111-4111-8111-111111111111";
const SCRIPT_ID = "22222222-2222-4222-8222-222222222222";
const CAPTURED_KEY = "scripts/night-diner/script.pdf";
const REPLACEMENT_KEY = "scripts/night-diner/replacement.pdf";

const MOVIE_ROW = { id: MOVIE_ID, title: "Night Diner" };

/**
 * A Pool that answers the two lock queries from the rows given and keeps every
 * statement it was asked for. withFilmWrite reaches a database only through
 * pool.connect(), which is the whole seam this stands in.
 */
function recordingPool({ movie = MOVIE_ROW, script = { s3_key: CAPTURED_KEY } } = {}) {
    const statements = [];
    const client = {
        async query(text) {
            statements.push(text);
            if (text.includes("FROM movies")) return { rows: movie ? [movie] : [] };
            if (text.includes("FROM scripts")) return { rows: script ? [script] : [] };
            return { rows: [] };
        },
        release() {},
    };
    return { pool: { connect: async () => client }, statements };
}

/** The rows the write locked, in the order it locked them. */
function locks(statements) {
    return statements.filter((text) => text.includes("FOR NO KEY UPDATE"));
}

/** Records that work ran, and with what, so a refusal can be shown to skip it. */
function spyWork(result = "written") {
    const calls = [];
    return {
        calls,
        work: (client, movie) => {
            calls.push({ client, movie });
            return result;
        },
    };
}

async function refusal(promise) {
    return await promise.then(
        () => assert.fail("the write was expected to be refused"),
        (error) => error
    );
}

/** The error a call threw at the call itself, rather than through its promise. */
function thrownBy(call) {
    let returned;
    try {
        returned = call();
    } catch (error) {
        return error;
    }
    Promise.resolve(returned).catch(() => {});
    return assert.fail("the call was expected to throw");
}

describe("withFilmWrite and the key of the captured PDF", () => {
    test("runs the work when the key still matches the script, locking movie then script", async () => {
        const { pool: recorder, statements } = recordingPool();
        const { calls, work } = spyWork();

        const result = await withFilmWrite(recorder, { movieId: MOVIE_ID, scriptId: SCRIPT_ID, scriptKey: CAPTURED_KEY }, work);

        assert.equal(result, "written");
        assert.deepEqual(calls.map(({ movie }) => movie), [MOVIE_ROW]);
        assert.deepEqual(
            locks(statements).map((text) => (text.includes("FROM movies") ? "movies" : "scripts")),
            ["movies", "scripts"]
        );
        assert.ok(statements.includes("COMMIT"), statements.join(" | "));
    });

    test("refuses a key the script no longer carries with the 409 the client shows", async () => {
        const { pool: recorder, statements } = recordingPool({ script: { s3_key: REPLACEMENT_KEY } });
        const { calls, work } = spyWork();

        const error = await refusal(
            withFilmWrite(recorder, { movieId: MOVIE_ID, scriptId: SCRIPT_ID, scriptKey: CAPTURED_KEY }, work)
        );

        assert.ok(error instanceof HttpError, error.stack);
        assert.equal(error.status, 409);
        assert.equal(error.message, "The script PDF has changed. Reload it before saving a scene.");
        assert.deepEqual(calls, []);
        assert.ok(statements.includes("ROLLBACK"), statements.join(" | "));
    });

    test("refuses a null key, the request that named a script but carried no key, with the 400", async () => {
        const { pool: recorder } = recordingPool();
        const { calls, work } = spyWork();

        const error = await refusal(
            withFilmWrite(recorder, { movieId: MOVIE_ID, scriptId: SCRIPT_ID, scriptKey: null }, work)
        );

        assert.ok(error instanceof HttpError, error.stack);
        assert.equal(error.status, 400);
        assert.equal(error.message, "Reload the script before saving a scene.");
        assert.deepEqual(calls, []);
    });

    // Neither answer above fits a caller that never decided, and reading it as a
    // missing key would skip both of them. It is a mistake in the calling code,
    // so it fails at the call and never becomes an HttpError a user could be
    // told to act on.
    for (const [name, film] of [
        ["left off", { movieId: MOVIE_ID, scriptId: SCRIPT_ID }],
        ["undefined, as `body?.script_key` gives with no key in the body", { movieId: MOVIE_ID, scriptId: SCRIPT_ID, scriptKey: undefined }],
    ]) {
        test(`throws at the call when the key is ${name}`, () => {
            const { pool: recorder, statements } = recordingPool();
            const { calls, work } = spyWork();

            const error = thrownBy(() => withFilmWrite(recorder, film, work));

            assert.ok(!(error instanceof HttpError), error.stack);
            assert.match(error.message, /needs the scriptKey that goes with scriptId/);
            assert.deepEqual(statements, [], "no transaction should have opened");
            assert.deepEqual(calls, []);
        });
    }

    test("takes no script lock at all when no script is named", async () => {
        const { pool: recorder, statements } = recordingPool({ script: null });
        const { calls, work } = spyWork();

        const result = await withFilmWrite(recorder, { movieId: MOVIE_ID }, work);

        assert.equal(result, "written");
        assert.deepEqual(calls.map(({ movie }) => movie), [MOVIE_ROW]);
        assert.deepEqual(locks(statements), ["SELECT * FROM movies WHERE id = $1 FOR NO KEY UPDATE"]);
        assert.ok(!statements.some((text) => text.includes("FROM scripts")), statements.join(" | "));
    });

    test("still answers 404 for a missing movie before it looks at any key", async () => {
        const { pool: recorder } = recordingPool({ movie: null });
        const { calls, work } = spyWork();

        const error = await refusal(
            withFilmWrite(recorder, { movieId: MOVIE_ID, scriptId: SCRIPT_ID, scriptKey: null }, work)
        );

        assert.equal(error.status, 404);
        assert.equal(error.message, "Movie not found");
        assert.deepEqual(calls, []);
    });
});
