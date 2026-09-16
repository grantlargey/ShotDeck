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
            created_at: first.created_at,
        });
    });
});

describe("searching captured scenes", () => {
    test("is public, returns every movie most-recently-updated first and adds movie_title", async () => {
        const first = await createMovieWithScript(api, cookie);
        const second = await createMovieWithScript(api, cookie);
        const older = await createScene(api, cookie, first);
        const newer = await createScene(api, cookie, second);
        const touched = await api.put(`${scenesPath(first)}/${older.id}`, {
            cookie,
            body: sceneBody({ tags: [TAGS.revelation] }),
        });
        assert.equal(touched.status, 200, touched.text);

        const response = await api.get("/script-scenes");
        assert.equal(response.status, 200);
        assert.deepEqual(onlyMine(response.body, [older, newer]), [older.id, newer.id]);
        const result = response.body.find((scene) => scene.id === older.id);
        const { movie_title: movieTitle, ...scene } = result;
        assert.deepEqual(scene, touched.body);
        assert.equal(movieTitle, first.movie.title);
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
        await pool.query(
            `INSERT INTO captured_scenes (
               id, script_id, start_time_seconds, end_time_seconds,
               start_page, start_line, start_top, start_bottom, start_text,
               end_page, end_line, end_top, end_bottom, end_text, scene_text, raw_text
             )
             SELECT gen_random_uuid(), $1, 0, 0, 1, n * 2, n * 12, n * 12 + 10, 'Start',
                    1, n * 2, n * 12, n * 12 + 10, 'End', 'Text', 'Text'
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
