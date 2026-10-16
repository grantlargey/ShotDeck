import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import { assertSameRecords, createFilm, filmBody, signedUrlPattern } from "./helpers/fixtures.js";
import { pool } from "../src/db.js";

/*
 * Characterization of the still routes: POST, GET, PUT and DELETE
 * /movies/:filmId/annotations. Saving or listing a still also queues its
 * thumbnail in the background; with S3 unreachable in tests, that fails and
 * logs "Failed to create still thumbnail" without changing any response.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const INVALID_STILL =
    "Invalid body. Expected { time_seconds:number to a tenth of a second, (optional) image_key:string }";
const STILL_FIELDS = [
    "id",
    "image_key",
    "image_url",
    "image_url_expires_at",
    "movie_id",
    "thumb_key",
    "thumb_url",
    "thumb_url_expires_at",
    "time_seconds",
];

/** The 409 for a moment another shot holds, naming the next free tenth of that second. */
function takenMoment(time, free) {
    return `${time} already holds a shot. The next free moment in that second is ${free}. To place this shot earlier than the ones already there, retime those first.`;
}
const PAST_RUNTIME = "The timestamp cannot exceed the film's stored runtime plus one minute.";

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

function stillsPath(film) {
    return `/movies/${film.id}/annotations`;
}

async function createStill(film, body) {
    const response = await api.post(stillsPath(film), { cookie, body });
    assert.equal(response.status, 201, response.text);
    return response.body;
}

describe("creating a still", () => {
    test("allows the rounded-runtime allowance through its endpoint and rejects anything beyond it", async () => {
        const film = await createFilm(api, cookie, { runtime_minutes: 90 });
        for (const time_seconds of [0, 5400, 5425, 5460]) {
            await createStill(film, { time_seconds });
        }
        await expectError(api.post(stillsPath(film), { cookie, body: { time_seconds: 5461 } }), 400, PAST_RUNTIME);
        assert.equal((await api.get(stillsPath(film))).body.length, 4);
    });

    test("rejects a moment another shot holds, including concurrent creates, but allows it in another film", async () => {
        const film = await createFilm(api, cookie);
        const requests = await Promise.all([1, 2].map(() => api.post(stillsPath(film), { cookie, body: { time_seconds: 42 } })));
        assert.deepEqual(requests.map((r) => r.status).sort(), [201, 409]);
        // The loser is refused by the constraint or by the check before it, and
        // reads the same either way.
        assert.equal(requests.find((r) => r.status === 409).body.error, takenMoment("00:00:42", "00:00:42.1"));
        await expectError(
            api.post(stillsPath(film), { cookie, body: { time_seconds: 42 } }),
            409,
            takenMoment("00:00:42", "00:00:42.1")
        );
        await createStill(await createFilm(api, cookie), { time_seconds: 42 });
        assert.equal((await api.get(stillsPath(film))).body.length, 1);
    });

    test("keeps two shots caught in the same second apart by a tenth", async () => {
        const film = await createFilm(api, cookie);
        const first = await createStill(film, { time_seconds: 42 });
        const second = await createStill(film, { time_seconds: 42.1 });

        assert.equal(typeof second.time_seconds, "number");
        assert.deepEqual(
            (await api.get(stillsPath(film))).body.map((row) => row.time_seconds),
            [42, 42.1]
        );
        await expectError(
            api.put(`${stillsPath(film)}/${first.id}`, { cookie, body: { time_seconds: 42.1 } }),
            409,
            takenMoment("00:00:42.1", "00:00:42.2")
        );
        assert.equal((await api.get(stillsPath(film))).body[0].time_seconds, 42);
    });

    test("names a free moment below a taken one, and refuses a second with none left", async () => {
        const film = await createFilm(api, cookie);
        for (const time_seconds of [42.8, 42.9]) await createStill(film, { time_seconds });
        await expectError(
            api.post(stillsPath(film), { cookie, body: { time_seconds: 42.8 } }),
            409,
            "00:00:42.8 already holds a shot. Nothing later in that second is free, but 00:00:42 is. To keep this shot after the ones already there, retime those first."
        );

        for (const time_seconds of [42, 42.1, 42.2, 42.3, 42.4, 42.5, 42.6, 42.7]) {
            await createStill(film, { time_seconds });
        }
        await expectError(
            api.post(stillsPath(film), { cookie, body: { time_seconds: 42.3 } }),
            409,
            "00:00:42.3 already holds a shot. Every tenth of 00:00:42 is taken, so choose another second."
        );
    });

    test("replays an identity without duplicating the still or overwriting later edits", async () => {
        const film = await createFilm(api, cookie);
        const id = randomUUID();
        const body = { id, time_seconds: 42 };
        const [first, retry] = await Promise.all([createStill(film, body), createStill(film, body)]);
        assert.equal(first.id, id);
        assert.equal(retry.id, id);
        assert.equal((await api.get(stillsPath(film))).body.length, 1);
        const edited = await api.put(`${stillsPath(film)}/${id}`, { cookie, body: { time_seconds: 60 } });
        assert.equal(edited.status, 200);
        await createStill(film, { time_seconds: 42 });
        const replay = await createStill(film, body);
        assert.equal(replay.time_seconds, 60);
    });

    test("rejects malformed identities and cannot replay a still belonging to another film", async () => {
        const film = await createFilm(api, cookie);
        for (const id of ["invalid", null, 42]) {
            await expectError(api.post(stillsPath(film), { cookie, body: { id, time_seconds: 1 } }), 400, "Invalid still id. Expected a UUID.");
        }
        const still = await createStill(film, { id: randomUUID(), time_seconds: 1 });
        const other = await createFilm(api, cookie);
        await expectError(api.post(stillsPath(other), { cookie, body: { id: still.id, time_seconds: 2 } }), 409, "Still identity is already in use.");
        assert.equal((await api.get(stillsPath(other))).body.length, 0);
        assert.equal((await api.get(stillsPath(film))).body[0].time_seconds, 1);
    });

    test("returns 201 with the still and a signed image URL, and no title or body", async () => {
        const film = await createFilm(api, cookie);
        const key = `annotations/${film.id}/frame.jpg`;
        const response = await api.post(stillsPath(film), { cookie, body: { time_seconds: 42, image_key: key } });

        assert.equal(response.status, 201, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), STILL_FIELDS);
        assert.equal(response.body.movie_id, film.id);
        assert.equal(response.body.time_seconds, 42);
        assert.equal(response.body.image_key, key);
        assert.match(response.body.image_url, signedUrlPattern(key));
        assert.equal(response.body.thumb_key, null);
        assert.equal(response.body.thumb_url, null);
    });

    test("without an image, or with a null one, has null image fields", async () => {
        const film = await createFilm(api, cookie);
        for (const body of [{ time_seconds: 0 }, { time_seconds: 1, image_key: null }]) {
            const still = await createStill(film, body);
            assert.equal(still.image_key, null);
            assert.equal(still.image_url, null);
        }
    });

    test("ignores removed title and body fields", async () => {
        const film = await createFilm(api, cookie);
        const still = await createStill(film, { time_seconds: 1, title: 5, body: { legacy: true } });
        assert.ok(!("title" in still));
        assert.ok(!("body" in still));
    });

    test("requires a non-negative number of seconds and a string image key, checked before the film is looked up", async () => {
        const film = await createFilm(api, cookie);
        for (const body of [{}, { time_seconds: "10" }, { time_seconds: -1 }, { time_seconds: null }, { time_seconds: 3, image_key: 5 }]) {
            await expectError(api.post(stillsPath(film), { cookie, body }), 400, INVALID_STILL);
        }
        await expectError(api.post(`/movies/${randomUUID()}/annotations`, { cookie, body: {} }), 400, INVALID_STILL);
        await expectError(api.post(`/movies/${randomUUID()}/annotations`, { cookie, body: { time_seconds: 3 } }), 404, "Film not found");
    });

    test("keeps a tenth of a second and rejects anything finer", async () => {
        const film = await createFilm(api, cookie);
        const still = await createStill(film, { time_seconds: 1.5 });
        assert.equal(still.time_seconds, 1.5);
        for (const time_seconds of [1.25, 1.05, 0.01]) {
            await expectError(api.post(stillsPath(film), { cookie, body: { time_seconds } }), 400, INVALID_STILL);
        }
    });

    test("requires the sign-in cookie", async () => {
        const film = await createFilm(api, cookie);
        await expectError(api.post(stillsPath(film), { body: { time_seconds: 3 } }), 401, "Sign in to make changes.");
    });

    test("a signed-in create with no body at all is a 400", async () => {
        const film = await createFilm(api, cookie);
        await expectError(api.post(stillsPath(film), { cookie }), 400, INVALID_STILL);
    });
});

describe("listing stills", () => {
    test("is public and lists a film's stills by time_seconds regardless of creation order", async () => {
        const film = await createFilm(api, cookie);
        const late = await createStill(film, { time_seconds: 90 });
        const earlyFirst = await createStill(film, { time_seconds: 10, image_key: `annotations/${film.id}/a.png` });
        const earlySecond = await createStill(film, { time_seconds: 11 });

        const response = await api.get(stillsPath(film));
        assert.equal(response.status, 200);
        assertSameRecords(response.body, [earlyFirst, earlySecond, late]);
        assert.deepEqual((await api.get(`/movies/${randomUUID()}/annotations`)).body, []);
    });

    test("signs a thumbnail URL once the still has a thumbnail", async () => {
        const film = await createFilm(api, cookie);
        const still = await createStill(film, { time_seconds: 5, image_key: `annotations/${film.id}/b.jpg` });
        const thumbKey = `annotations/${film.id}/thumbs/b.jpg.webp`;
        await pool.query("UPDATE annotations SET thumb_key = $1 WHERE id = $2", [thumbKey, still.id]);

        const [listed] = (await api.get(stillsPath(film))).body;
        assert.equal(listed.thumb_key, thumbKey);
        assert.match(listed.thumb_url, signedUrlPattern(thumbKey));
    });
});

describe("sampling stills", () => {
    test("is public, returns only stills with images, and adds each one's film title", async () => {
        const film = await createFilm(api, cookie, { title: "Sampled Film" });
        await createStill(film, { time_seconds: 1 });
        await createStill(film, { time_seconds: 2.5, image_key: `annotations/${film.id}/sampled.jpg` });

        const response = await api.get("/stills/sample");
        assert.equal(response.status, 200);
        assert.ok(response.body.length > 0);
        for (const still of response.body) {
            assert.deepEqual(Object.keys(still).sort(), [...STILL_FIELDS, "movie_title"].sort());
            assert.equal(typeof still.time_seconds, "number");
            assert.match(still.image_url, signedUrlPattern(still.image_key));
            const titleRow = await pool.query("SELECT title FROM movies WHERE id = $1", [still.movie_id]);
            assert.equal(still.movie_title, titleRow.rows[0].title);
        }
    });

    test("draws at most 24 stills", async () => {
        const film = await createFilm(api, cookie);
        for (let second = 0; second < 25; second += 1) {
            await createStill(film, { time_seconds: second, image_key: `annotations/${film.id}/${second}.jpg` });
        }

        assert.equal((await api.get("/stills/sample")).body.length, 24);
    });

    test("fills up on stills that have a thumbnail before it reaches for one without", async () => {
        const film = await createFilm(api, cookie);
        for (let second = 0; second < 30; second += 1) {
            const still = await createStill(film, {
                time_seconds: second,
                image_key: `annotations/${film.id}/ordered-${second}.jpg`,
            });
            // The queue makes thumbnails in the background, so most of these are
            // still waiting for one while a handful already have theirs.
            if (second % 6 !== 0) continue;
            await pool.query("UPDATE annotations SET thumb_key = $1 WHERE id = $2", [
                `annotations/${film.id}/thumbs/ordered-${second}.jpg.webp`,
                still.id,
            ]);
        }

        const ready = await pool.query(
            "SELECT count(*)::int AS total FROM annotations WHERE image_key IS NOT NULL AND thumb_key IS NOT NULL"
        );
        const sampled = (await api.get("/stills/sample")).body;
        // Every place in the sample goes to a still with a thumbnail while one is
        // left; only then does a still still waiting for its thumbnail stand in.
        assert.equal(
            sampled.filter((still) => still.thumb_key !== null).length,
            Math.min(24, ready.rows[0].total)
        );
    });
});

describe("updating a still", () => {
    test("checks runtime and uniqueness without modifying a rejected shot, and permits its own timestamp", async () => {
        const film = await createFilm(api, cookie, { runtime_minutes: 90 });
        const first = await createStill(film, { time_seconds: 10 });
        await createStill(film, { time_seconds: 20 });
        const path = `${stillsPath(film)}/${first.id}`;
        await expectError(api.put(path, { cookie, body: { time_seconds: 20 } }), 409, takenMoment("00:00:20", "00:00:20.1"));
        await expectError(api.put(path, { cookie, body: { time_seconds: 5461 } }), 400, PAST_RUNTIME);
        await expectError(api.put(path, { cookie, body: { time_seconds: 10.55 } }), 400, INVALID_STILL);
        assert.equal((await api.get(stillsPath(film))).body.find((row) => row.id === first.id).time_seconds, 10);
        for (const time_seconds of [10, 5425, 5460]) {
            const response = await api.put(path, { cookie, body: { time_seconds } });
            assert.equal(response.status, 200, response.text);
            assert.equal(response.body.time_seconds, time_seconds);
        }
    });

    test("concurrent moves to the same second save only one shot", async () => {
        const film = await createFilm(api, cookie);
        const shots = await Promise.all([10, 20].map((time_seconds) => createStill(film, { time_seconds })));
        const responses = await Promise.all(shots.map((shot) => api.put(`${stillsPath(film)}/${shot.id}`, {
            cookie, body: { time_seconds: 30 },
        })));
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    });

    async function stillWithThumbnail() {
        const film = await createFilm(api, cookie);
        const still = await createStill(film, { time_seconds: 5, image_key: `annotations/${film.id}/c.jpg`, title: "Old", body: "Old body" });
        const thumbKey = `annotations/${film.id}/thumbs/c.jpg.webp`;
        await pool.query("UPDATE annotations SET thumb_key = $1 WHERE id = $2", [thumbKey, still.id]);
        return { film, still: { ...still, thumb_key: thumbKey }, thumbKey };
    }

    test("returns 200 and keeps the saved image and its thumbnail when image_key is left out", async () => {
        const { film, still, thumbKey } = await stillWithThumbnail();
        const response = await api.put(`${stillsPath(film)}/${still.id}`, { cookie, body: { time_seconds: 8 } });

        assert.equal(response.status, 200, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), STILL_FIELDS);
        assert.equal(response.body.time_seconds, 8);
        assert.equal(response.body.image_key, still.image_key);
        assert.equal(response.body.thumb_key, thumbKey);
        assert.match(response.body.thumb_url, signedUrlPattern(thumbKey));
    });

    test("a new image clears the thumbnail, the same image keeps it, and null clears both", async () => {
        const { film, still, thumbKey } = await stillWithThumbnail();
        const path = `${stillsPath(film)}/${still.id}`;

        const same = await api.put(path, { cookie, body: { time_seconds: 5, image_key: still.image_key } });
        assert.equal(same.body.thumb_key, thumbKey);

        const replaced = await api.put(path, { cookie, body: { time_seconds: 5, image_key: `annotations/${film.id}/d.jpg` } });
        assert.equal(replaced.body.image_key, `annotations/${film.id}/d.jpg`);
        assert.equal(replaced.body.thumb_key, null);
        assert.equal(replaced.body.thumb_url, null);

        const cleared = await api.put(path, { cookie, body: { time_seconds: 5, image_key: null } });
        assert.equal(cleared.body.image_key, null);
        assert.equal(cleared.body.image_url, null);
    });

    test("ignores removed title and body fields on update", async () => {
        const { film, still } = await stillWithThumbnail();
        const path = `${stillsPath(film)}/${still.id}`;
        const response = await api.put(path, {
            cookie,
            body: { time_seconds: 6, title: 5, body: { legacy: true } },
        });
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.time_seconds, 6);
    });

    test("requires time_seconds, even with no body at all, and answers 404 for a missing still or one in another film after validating", async () => {
        const { film, still } = await stillWithThumbnail();
        const other = await createFilm(api, cookie);

        await expectError(api.put(`${stillsPath(film)}/${still.id}`, { cookie, body: {} }), 400, INVALID_STILL);
        await expectError(api.put(`${stillsPath(film)}/${still.id}`, { cookie }), 400, INVALID_STILL);
        await expectError(api.put(`${stillsPath(film)}/${randomUUID()}`, { cookie, body: {} }), 400, INVALID_STILL);
        await expectError(api.put(`${stillsPath(film)}/${randomUUID()}`, { cookie, body: { time_seconds: 1 } }), 404, "Annotation not found");
        await expectError(api.put(`${stillsPath(other)}/${still.id}`, { cookie, body: { time_seconds: 1 } }), 404, "Annotation not found");
    });

    test("requires the sign-in cookie", async () => {
        const { film, still } = await stillWithThumbnail();
        await expectError(api.put(`${stillsPath(film)}/${still.id}`, { body: { time_seconds: 1 } }), 401, "Sign in to make changes.");
    });
});

describe("runtime edits with existing shots", () => {
    test("allows a shot at runtime plus one minute and refuses a shorter runtime", async () => {
        const film = await createFilm(api, cookie, { runtime_minutes: 100 });
        await createStill(film, { time_seconds: 5460 });
        const accepted = await api.put(`/movies/${film.id}`, { cookie, body: filmBody({ runtime_minutes: 90 }) });
        assert.equal(accepted.status, 200, accepted.text);
        const rejected = await api.put(`/movies/${film.id}`, { cookie, body: filmBody({ runtime_minutes: 89 }) });
        assert.equal(rejected.status, 400, rejected.text);
        assert.equal((await api.get(`/movies/${film.id}`)).body.runtime_minutes, 90);
    });

    test("concurrent runtime shortening and shot creation cannot leave an out-of-bounds shot", async () => {
        const film = await createFilm(api, cookie, { runtime_minutes: 100 });
        const [runtime, shot] = await Promise.all([
            api.put(`/movies/${film.id}`, { cookie, body: filmBody({ runtime_minutes: 90 }) }),
            api.post(stillsPath(film), { cookie, body: { time_seconds: 6000 } }),
        ]);
        assert.ok((runtime.status === 200 && shot.status === 400) || (runtime.status === 400 && shot.status === 201));
        const stored = (await api.get(`/movies/${film.id}`)).body;
        for (const still of (await api.get(stillsPath(film))).body) {
            assert.ok(still.time_seconds <= (stored.runtime_minutes + 1) * 60);
        }
    });
});

describe("deleting a still", () => {
    test("returns 204 and removes it; a missing still or one in another film is a 404", async () => {
        const film = await createFilm(api, cookie);
        const other = await createFilm(api, cookie);
        const still = await createStill(film, { time_seconds: 3 });

        await expectError(api.delete(`${stillsPath(other)}/${still.id}`, { cookie }), 404, "Annotation not found");
        await expectError(api.delete(`${stillsPath(film)}/${still.id}`), 401, "Sign in to make changes.");

        const response = await api.delete(`${stillsPath(film)}/${still.id}`, { cookie });
        assert.equal(response.status, 204);
        assert.equal(response.text, "");
        assert.deepEqual((await api.get(stillsPath(film))).body, []);
        await expectError(api.delete(`${stillsPath(film)}/${still.id}`, { cookie }), 404, "Annotation not found");
    });
});
