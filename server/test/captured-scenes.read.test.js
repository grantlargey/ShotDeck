import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { pool } from "../src/db.js";
import { signInOwner, startApi } from "./helpers/api.js";
import { anchorPair, createMovieWithScript, createScene, sceneBody, scenesPath, TAGS } from "./helpers/fixtures.js";

const api = await startApi();
const { cookie } = await signInOwner(api);

const ids = (scenes) => scenes.map((scene) => scene.id);

function onlyMine(results, mine) {
    const wanted = new Set(ids(mine));
    return ids(results).filter((id) => wanted.has(id));
}

function query(params) {
    return new URLSearchParams(params).toString();
}

async function createStill(movie, timeSeconds, imageKey) {
    const response = await api.post(`/movies/${movie.id}/annotations`, {
        cookie,
        body: { time_seconds: timeSeconds, ...(imageKey === undefined ? {} : { image_key: imageKey }) },
    });
    assert.equal(response.status, 201, response.text);
    return response.body;
}

describe("listing a script's captured scenes", () => {
    test("orders by start page, start line and id", async () => {
        const place = await createMovieWithScript(api, cookie);
        const pageThree = await createScene(api, cookie, place, {
            start_time_seconds: 0,
            end_time_seconds: 10,
            script_location: anchorPair({ startPage: 3, startLine: 0 }),
        });
        const pageOneLater = await createScene(api, cookie, place, {
            start_time_seconds: 20,
            end_time_seconds: 30,
            script_location: anchorPair({ startPage: 1, startLine: 20 }),
        });
        const pageOneEarlier = await createScene(api, cookie, place, {
            start_time_seconds: 40,
            end_time_seconds: 50,
            script_location: anchorPair({ startPage: 1, startLine: 0 }),
        });
        const response = await api.get(scenesPath(place));
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, [pageOneEarlier, pageOneLater, pageThree]);
    });

    test("is public and answers an empty list outside the requested script", async () => {
        const place = await createMovieWithScript(api, cookie);
        const other = await createMovieWithScript(api, cookie);
        await createScene(api, cookie, other);
        for (const path of [
            scenesPath(place),
            scenesPath({ movie: place.movie, script: { id: randomUUID() } }),
            scenesPath({ movie: place.movie, script: other.script }),
        ]) {
            const response = await api.get(path);
            assert.equal(response.status, 200);
            assert.deepEqual(response.body, []);
        }
    });

    test("returns the earliest still with an image inside the film timing, edges included", async () => {
        const place = await createMovieWithScript(api, cookie);
        const scene = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        await createStill(place.movie, 59, `annotations/${place.movie.id}/before.jpg`);
        await createStill(place.movie, 80);
        const first = await createStill(place.movie, 100, `annotations/${place.movie.id}/first.jpg`);
        await createStill(place.movie, 120, `annotations/${place.movie.id}/end.jpg`);
        await pool.query("UPDATE annotations SET thumb_key = $1 WHERE id = $2", [
            `annotations/${place.movie.id}/thumbs/first.jpg.webp`,
            first.id,
        ]);
        const listed = (await api.get(scenesPath(place))).body.find((candidate) => candidate.id === scene.id);
        assert.deepEqual(listed.first_image_annotation, {
            id: first.id,
            time_seconds: 100,
            image_key: first.image_key,
            thumb_key: `annotations/${place.movie.id}/thumbs/first.jpg.webp`,
        });
    });

    test("keeps a shot timed within a scene's end second with that scene, not the next", async () => {
        const place = await createMovieWithScript(api, cookie);
        const scene = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        const next = await createScene(api, cookie, place, { start_time_seconds: 121, end_time_seconds: 180 });
        const edge = await createStill(place.movie, 120.9, `annotations/${place.movie.id}/edge.jpg`);
        const after = await createStill(place.movie, 121, `annotations/${place.movie.id}/after.jpg`);

        const listed = (await api.get(scenesPath(place))).body;
        const firstImage = (id) => listed.find((candidate) => candidate.id === id).first_image_annotation;
        assert.deepEqual(firstImage(scene.id), {
            id: edge.id,
            time_seconds: 120.9,
            image_key: edge.image_key,
            thumb_key: null,
        });
        assert.equal(firstImage(next.id).id, after.id);
    });
});

describe("searching captured scenes", () => {
    test("is public, orders by film title then film time, and adds movie_title", async () => {
        const zulu = await createMovieWithScript(api, cookie, { title: "Zulu Diner" });
        const alpha = await createMovieWithScript(api, cookie, { title: "Alpha Diner" });
        // Saved newest-first and out of title order, so neither can pass by accident.
        const late = await createScene(api, cookie, alpha, { start_time_seconds: 900, end_time_seconds: 960 });
        const early = await createScene(api, cookie, alpha, { start_time_seconds: 10, end_time_seconds: 20 });
        const other = await createScene(api, cookie, zulu);
        const touched = await api.put(`${scenesPath(alpha)}/${late.id}`, {
            cookie,
            body: sceneBody({ script_key: alpha.script.s3_key, tags: [TAGS.revelation], start_time_seconds: 900, end_time_seconds: 960 }),
        });
        assert.equal(touched.status, 200, touched.text);

        const response = await api.get("/script-scenes");
        assert.equal(response.status, 200);
        assert.deepEqual(onlyMine(response.body, [late, early, other]), [early.id, late.id, other.id]);
        const result = response.body.find((scene) => scene.id === late.id);
        const { movie_title: movieTitle, ...scene } = result;
        assert.deepEqual(scene, touched.body);
        assert.equal(movieTitle, "Alpha Diner");
    });

    test("includes movie_title when the allowed movie title is empty", async () => {
        const place = await createMovieWithScript(api, cookie);
        await api.put(`/movies/${place.movie.id}`, {
            cookie,
            body: {
                title: "",
                director: place.movie.director,
                writer: place.movie.writer,
                cinematographer: place.movie.cinematographer,
                year: place.movie.year,
                runtime_minutes: place.movie.runtime_minutes,
            },
        });
        const scene = await createScene(api, cookie, place);
        const result = (await api.get("/script-scenes")).body.find((candidate) => candidate.id === scene.id);
        assert.ok(Object.hasOwn(result, "movie_title"));
        assert.equal(result.movie_title, "");
    });

    test("filters by every tag unless match=any", async () => {
        const place = await createMovieWithScript(api, cookie);
        const both = await createScene(api, cookie, place, {
            tags: [TAGS.protagonist, TAGS.revelation],
            start_time_seconds: 0,
            end_time_seconds: 10,
        });
        const one = await createScene(api, cookie, place, {
            tags: [TAGS.revelation],
            start_time_seconds: 20,
            end_time_seconds: 30,
        });
        const other = await createScene(api, cookie, place, {
            tags: [TAGS.selfConflict],
            start_time_seconds: 40,
            end_time_seconds: 50,
        });
        const mine = [both, one, other];
        const search = async (params) => onlyMine((await api.get(`/script-scenes?${params}`)).body, mine);
        assert.deepEqual(await search(query({ tags: `${TAGS.protagonist},${TAGS.revelation}` })), [both.id]);
        assert.deepEqual(
            (await search(query({ tags: `${TAGS.protagonist},${TAGS.selfConflict}`, match: "any" }))).sort(),
            [both.id, other.id].sort()
        );
    });

    test("ignores q and limit and returns at most 500", async () => {
        const place = await createMovieWithScript(api, cookie);
        // Two scenes to a page and a second of film each, so none of them share
        // a location or a second.
        await pool.query(
            `INSERT INTO captured_scenes (
               id, script_id, start_time_seconds, end_time_seconds,
               start_page, start_y, end_page, end_y, scene_text
             )
             SELECT gen_random_uuid(), $1, n * 2, n * 2,
                    (n + 1) / 2, CASE WHEN n % 2 = 1 THEN 100 ELSE 300 END,
                    (n + 1) / 2, CASE WHEN n % 2 = 1 THEN 200 ELSE 400 END, 'Text'
             FROM generate_series(1, 501) AS n`,
            [place.script.id]
        );
        for (const path of ["/script-scenes", "/script-scenes?q=zebra&limit=1000"]) {
            const response = await api.get(path);
            assert.equal(response.status, 200);
            assert.equal(response.body.length, 500);
        }
    });
});

describe("sampling captured scenes", () => {
    test("is public and returns scenes in the search shape, with movie_title", async () => {
        // At least one scene exists to sample.
        await createScene(api, cookie, await createMovieWithScript(api, cookie));

        const response = await api.get("/script-scenes/sample");
        assert.equal(response.status, 200);
        assert.ok(response.body.length > 0);
        for (const { movie_title: movieTitle, ...sampled } of response.body) {
            const place = { movie: { id: sampled.movie_id }, script: { id: sampled.script_id } };
            const saved = (await api.get(scenesPath(place))).body.find((candidate) => candidate.id === sampled.id);
            assert.deepEqual(sampled, saved);
            const film = await pool.query("SELECT title FROM movies WHERE id = $1", [sampled.movie_id]);
            assert.equal(movieTitle, film.rows[0].title);
        }
    });

    test("draws at most 12 scenes", async () => {
        const place = await createMovieWithScript(api, cookie);
        for (let n = 0; n < 13; n += 1) {
            await createScene(api, cookie, place, {
                start_time_seconds: n * 10,
                end_time_seconds: n * 10 + 5,
                script_location: anchorPair({ startPage: n + 1 }),
            });
        }

        assert.equal((await api.get("/script-scenes/sample")).body.length, 12);
    });
});
