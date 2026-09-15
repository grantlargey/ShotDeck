import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import { assertSameRecords, createMovie, signedUrlPattern } from "./helpers/fixtures.js";
import { pool } from "../src/db.js";

/*
 * Characterization of the still routes: POST, GET, PUT and DELETE
 * /movies/:movieId/annotations. Saving or listing a still also queues its
 * thumbnail in the background; with S3 unreachable in tests, that fails and
 * logs "Failed to create still thumbnail" without changing any response.
 *
 * "changes in NN" marks behavior that overhaul issue NN is expected to change.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const INVALID_STILL = "Invalid body. Expected { time_seconds:number, (optional) image_key:string }";
const STILL_FIELDS = ["created_at", "id", "image_key", "image_url", "movie_id", "thumb_key", "thumb_url", "time_seconds"];

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

function stillsPath(movie) {
    return `/movies/${movie.id}/annotations`;
}

async function createStill(movie, body) {
    const response = await api.post(stillsPath(movie), { cookie, body });
    assert.equal(response.status, 201, response.text);
    return response.body;
}

// changes in 11: still title and body are removed (A7)
async function storedTitleAndBody(still) {
    const result = await pool.query("SELECT title, body FROM annotations WHERE id = $1", [still.id]);
    return result.rows[0];
}

describe("creating a still", () => {
    test("returns 201 with the still and a signed image URL, and no title or body", async () => {
        const movie = await createMovie(api, cookie);
        const key = `annotations/${movie.id}/frame.jpg`;
        const response = await api.post(stillsPath(movie), { cookie, body: { time_seconds: 42, image_key: key } });

        assert.equal(response.status, 201, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), STILL_FIELDS);
        assert.equal(response.body.movie_id, movie.id);
        assert.equal(response.body.time_seconds, 42);
        assert.equal(response.body.image_key, key);
        assert.match(response.body.image_url, signedUrlPattern(key));
        assert.equal(response.body.thumb_key, null);
        assert.equal(response.body.thumb_url, null);
    });

    test("without an image, or with a null one, has null image fields", async () => {
        const movie = await createMovie(api, cookie);
        for (const body of [{ time_seconds: 0 }, { time_seconds: 1, image_key: null }]) {
            const still = await createStill(movie, body);
            assert.equal(still.image_key, null);
            assert.equal(still.image_url, null);
        }
    });

    // changes in 11: still title and body are removed (A7)
    test("stores a trimmed title and body without returning them, and accepts any title type", async () => {
        const movie = await createMovie(api, cookie);
        const titled = await createStill(movie, { time_seconds: 1, title: "  Diner  ", body: "  Night.  " });
        assert.deepEqual(await storedTitleAndBody(titled), { title: "Diner", body: "Night." });

        const untitled = await createStill(movie, { time_seconds: 2, title: 5, body: "   " });
        assert.deepEqual(await storedTitleAndBody(untitled), { title: "", body: null });
    });

    test("requires a non-negative number of seconds and a string image key, checked before the movie is looked up", async () => {
        const movie = await createMovie(api, cookie);
        for (const body of [{}, { time_seconds: "10" }, { time_seconds: -1 }, { time_seconds: null }, { time_seconds: 3, image_key: 5 }]) {
            await expectError(api.post(stillsPath(movie), { cookie, body }), 400, INVALID_STILL);
        }
        await expectError(api.post(`/movies/${randomUUID()}/annotations`, { cookie, body: {} }), 400, INVALID_STILL);
        await expectError(api.post(`/movies/${randomUUID()}/annotations`, { cookie, body: { time_seconds: 3 } }), 404, "Movie not found");
    });

    test("leaves whole seconds to the database, which makes a fraction a 500", async (t) => {
        t.mock.method(console, "error", () => {});
        const movie = await createMovie(api, cookie);
        await expectError(api.post(stillsPath(movie), { cookie, body: { time_seconds: 1.5 } }), 500, "Something went wrong on the server.");
    });

    test("requires the sign-in cookie", async () => {
        const movie = await createMovie(api, cookie);
        await expectError(api.post(stillsPath(movie), { body: { time_seconds: 3 } }), 401, "Sign in to make changes.");
    });

    // changes in 05: expected to become a 400 (B9)
    test("a signed-in create with no body at all is a 500", async (t) => {
        t.mock.method(console, "error", () => {});
        const movie = await createMovie(api, cookie);
        await expectError(api.post(stillsPath(movie), { cookie }), 500, "Something went wrong on the server.");
    });
});

describe("listing stills", () => {
    test("is public and lists a movie's stills by time, then creation order", async () => {
        const movie = await createMovie(api, cookie);
        const late = await createStill(movie, { time_seconds: 90 });
        const earlyFirst = await createStill(movie, { time_seconds: 10, image_key: `annotations/${movie.id}/a.png` });
        const earlySecond = await createStill(movie, { time_seconds: 10 });

        const response = await api.get(stillsPath(movie));
        assert.equal(response.status, 200);
        assertSameRecords(response.body, [earlyFirst, earlySecond, late]);
        assert.deepEqual((await api.get(`/movies/${randomUUID()}/annotations`)).body, []);
    });

    test("signs a thumbnail URL once the still has a thumbnail", async () => {
        const movie = await createMovie(api, cookie);
        const still = await createStill(movie, { time_seconds: 5, image_key: `annotations/${movie.id}/b.jpg` });
        const thumbKey = `annotations/${movie.id}/thumbs/b.jpg.webp`;
        await pool.query("UPDATE annotations SET thumb_key = $1 WHERE id = $2", [thumbKey, still.id]);

        const [listed] = (await api.get(stillsPath(movie))).body;
        assert.equal(listed.thumb_key, thumbKey);
        assert.match(listed.thumb_url, signedUrlPattern(thumbKey));
    });
});

describe("updating a still", () => {
    async function stillWithThumbnail() {
        const movie = await createMovie(api, cookie);
        const still = await createStill(movie, { time_seconds: 5, image_key: `annotations/${movie.id}/c.jpg`, title: "Old", body: "Old body" });
        const thumbKey = `annotations/${movie.id}/thumbs/c.jpg.webp`;
        await pool.query("UPDATE annotations SET thumb_key = $1 WHERE id = $2", [thumbKey, still.id]);
        return { movie, still: { ...still, thumb_key: thumbKey }, thumbKey };
    }

    test("returns 200 and keeps the saved image and its thumbnail when image_key is left out", async () => {
        const { movie, still, thumbKey } = await stillWithThumbnail();
        const response = await api.put(`${stillsPath(movie)}/${still.id}`, { cookie, body: { time_seconds: 8 } });

        assert.equal(response.status, 200, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), STILL_FIELDS);
        assert.equal(response.body.time_seconds, 8);
        assert.equal(response.body.image_key, still.image_key);
        assert.equal(response.body.thumb_key, thumbKey);
        assert.match(response.body.thumb_url, signedUrlPattern(thumbKey));
    });

    test("a new image clears the thumbnail, the same image keeps it, and null clears both", async () => {
        const { movie, still, thumbKey } = await stillWithThumbnail();
        const path = `${stillsPath(movie)}/${still.id}`;

        const same = await api.put(path, { cookie, body: { time_seconds: 5, image_key: still.image_key } });
        assert.equal(same.body.thumb_key, thumbKey);

        const replaced = await api.put(path, { cookie, body: { time_seconds: 5, image_key: `annotations/${movie.id}/d.jpg` } });
        assert.equal(replaced.body.image_key, `annotations/${movie.id}/d.jpg`);
        assert.equal(replaced.body.thumb_key, null);
        assert.equal(replaced.body.thumb_url, null);

        const cleared = await api.put(path, { cookie, body: { time_seconds: 5, image_key: null } });
        assert.equal(cleared.body.image_key, null);
        assert.equal(cleared.body.image_url, null);
    });

    // changes in 11: still title and body are removed (A7)
    test("always overwrites the stored title and body, blank when left out, and requires them to be strings or null", async () => {
        const { movie, still } = await stillWithThumbnail();
        const path = `${stillsPath(movie)}/${still.id}`;

        await api.put(path, { cookie, body: { time_seconds: 5, title: " New ", body: " New body " } });
        assert.deepEqual(await storedTitleAndBody(still), { title: "New", body: "New body" });

        await api.put(path, { cookie, body: { time_seconds: 5 } });
        assert.deepEqual(await storedTitleAndBody(still), { title: "", body: null });

        await expectError(api.put(path, { cookie, body: { time_seconds: 5, title: 5 } }), 400, INVALID_STILL);
        await expectError(api.put(path, { cookie, body: { time_seconds: 5, body: {} } }), 400, INVALID_STILL);
    });

    test("requires time_seconds, even with no body at all, and answers 404 for a missing still or one in another movie after validating", async () => {
        const { movie, still } = await stillWithThumbnail();
        const other = await createMovie(api, cookie);

        await expectError(api.put(`${stillsPath(movie)}/${still.id}`, { cookie, body: {} }), 400, INVALID_STILL);
        await expectError(api.put(`${stillsPath(movie)}/${still.id}`, { cookie }), 400, INVALID_STILL);
        await expectError(api.put(`${stillsPath(movie)}/${randomUUID()}`, { cookie, body: {} }), 400, INVALID_STILL);
        await expectError(api.put(`${stillsPath(movie)}/${randomUUID()}`, { cookie, body: { time_seconds: 1 } }), 404, "Annotation not found");
        await expectError(api.put(`${stillsPath(other)}/${still.id}`, { cookie, body: { time_seconds: 1 } }), 404, "Annotation not found");
    });

    test("requires the sign-in cookie", async () => {
        const { movie, still } = await stillWithThumbnail();
        await expectError(api.put(`${stillsPath(movie)}/${still.id}`, { body: { time_seconds: 1 } }), 401, "Sign in to make changes.");
    });
});

describe("deleting a still", () => {
    test("returns 204 and removes it; a missing still or one in another movie is a 404", async () => {
        const movie = await createMovie(api, cookie);
        const other = await createMovie(api, cookie);
        const still = await createStill(movie, { time_seconds: 3 });

        await expectError(api.delete(`${stillsPath(other)}/${still.id}`, { cookie }), 404, "Annotation not found");
        await expectError(api.delete(`${stillsPath(movie)}/${still.id}`), 401, "Sign in to make changes.");

        const response = await api.delete(`${stillsPath(movie)}/${still.id}`, { cookie });
        assert.equal(response.status, 204);
        assert.equal(response.text, "");
        assert.deepEqual((await api.get(stillsPath(movie))).body, []);
        await expectError(api.delete(`${stillsPath(movie)}/${still.id}`, { cookie }), 404, "Annotation not found");
    });
});
