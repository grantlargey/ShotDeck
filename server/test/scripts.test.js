import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import {
    assertSameRecords,
    createMovie,
    createMovieWithScript,
    saveScript,
    signedUrlPattern,
} from "./helpers/fixtures.js";

/*
 * Characterization of the script routes: POST and GET /movies/:id/scripts
 * and GET /movies/:movieId/scripts/:scriptId. The scene-by-time route is gone.
 *
 * "changes in NN" marks behavior that overhaul issue NN is expected to change.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const INVALID_SCRIPT = "Invalid body. Expected { s3_key:string }";
const SCRIPT_FIELDS = ["created_at", "id", "movie_id", "s3_key", "script_url"];

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

describe("saving a movie's script", () => {
    test("returns 201 with the script and a signed view URL, trimming the key", async () => {
        const movie = await createMovie(api, cookie);
        const key = `scripts/${movie.id}/draft.pdf`;
        const response = await api.post(`/movies/${movie.id}/scripts`, { cookie, body: { s3_key: `  ${key}  ` } });

        assert.equal(response.status, 201, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), SCRIPT_FIELDS);
        assert.equal(response.body.movie_id, movie.id);
        assert.equal(response.body.s3_key, key);
        assert.match(response.body.script_url, signedUrlPattern(key));
    });

    test("saving again replaces the file but keeps the script's id and creation time, still with 201", async () => {
        const movie = await createMovie(api, cookie);
        const first = await saveScript(api, cookie, movie);
        const response = await api.post(`/movies/${movie.id}/scripts`, { cookie, body: { s3_key: `scripts/${movie.id}/v2.pdf` } });

        assert.equal(response.status, 201, response.text);
        assert.equal(response.body.id, first.id);
        assert.equal(response.body.created_at, first.created_at);
        assert.equal(response.body.s3_key, `scripts/${movie.id}/v2.pdf`);
    });

    test("requires a key under scripts/, checked before the movie is looked up", async () => {
        const movie = await createMovie(api, cookie);
        for (const body of [{}, { s3_key: 5 }, { s3_key: "   " }, { s3_key: `covers/${movie.id}/a.pdf` }]) {
            await expectError(api.post(`/movies/${movie.id}/scripts`, { cookie, body }), 400, INVALID_SCRIPT);
        }
        await expectError(api.post(`/movies/${movie.id}/scripts`, { cookie }), 400, INVALID_SCRIPT);
        await expectError(api.post(`/movies/${randomUUID()}/scripts`, { cookie, body: {} }), 400, INVALID_SCRIPT);
        await expectError(
            api.post(`/movies/${randomUUID()}/scripts`, { cookie, body: { s3_key: "scripts/x/a.pdf" } }),
            404,
            "Movie not found"
        );
    });

    test("requires the sign-in cookie", async () => {
        const movie = await createMovie(api, cookie);
        await expectError(
            api.post(`/movies/${movie.id}/scripts`, { body: { s3_key: `scripts/${movie.id}/a.pdf` } }),
            401,
            "Sign in to make changes."
        );
    });
});

describe("reading scripts", () => {
    test("GET /movies/:id/scripts is public and returns the movie's script or null", async () => {
        const { movie, script } = await createMovieWithScript(api, cookie);
        const response = await api.get(`/movies/${movie.id}/scripts`);
        assert.equal(response.status, 200);
        assertSameRecords(response.body, script);

        const withoutScript = await createMovie(api, cookie);
        assert.equal((await api.get(`/movies/${withoutScript.id}/scripts`)).body, null);
        await expectError(api.get(`/movies/${randomUUID()}/scripts`), 404, "Movie not found");
    });

    test("GET /movies/:movieId/scripts/:scriptId is public and answers 404 unless the script is the movie's", async () => {
        const { movie, script } = await createMovieWithScript(api, cookie);
        const other = await createMovieWithScript(api, cookie);

        const response = await api.get(`/movies/${movie.id}/scripts/${script.id}`);
        assert.equal(response.status, 200);
        assertSameRecords(response.body, script);

        await expectError(api.get(`/movies/${movie.id}/scripts/${other.script.id}`), 404, "Script not found");
        await expectError(api.get(`/movies/${movie.id}/scripts/${randomUUID()}`), 404, "Script not found");
    });
});

describe("the scene-by-time route", () => {
    test("is gone: GET /movies/:movieId/scene-by-time answers 404", async () => {
        const place = await createMovieWithScript(api, cookie);
        const response = await api.get(`/movies/${place.movie.id}/scene-by-time?time=10&script_id=${place.script.id}`);
        assert.equal(response.status, 404);
    });
});
