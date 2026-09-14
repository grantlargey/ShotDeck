import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import {
    createMovieWithScript,
    createScene,
    scenesPath,
    signedUrlPattern,
    TAGS,
} from "./helpers/fixtures.js";
import { pool } from "../src/db.js";

/*
 * Characterization of captured-scene reads: the scoped list
 * (GET /movies/:movieId/scripts/:scriptId/scene-annotations) and global search
 * (GET /script-scenes).
 *
 * "changes in NN" marks behavior that overhaul issue NN is expected to change.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

function ids(scenes) {
    return scenes.map((scene) => scene.id);
}

/** The ids of `results` that are in `mine`, in the order the API returned them. */
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
    test("orders scenes by first page, scenes without one last, then by film timing; each is the saved scene", async () => {
        const place = await createMovieWithScript(api, cookie);
        const pageThree = await createScene(api, cookie, place, { page_start: 3, page_end: 3, start_time_seconds: 0, end_time_seconds: 10 });
        const noPage = await createScene(api, cookie, place, { page_start: null, page_end: null, start_time_seconds: 20, end_time_seconds: 30 });
        const pageOneLater = await createScene(api, cookie, place, { page_start: 1, page_end: 2, start_time_seconds: 100, end_time_seconds: 110 });
        const pageOneEarlier = await createScene(api, cookie, place, { page_start: 1, page_end: 1, start_time_seconds: 50, end_time_seconds: 60 });

        const response = await api.get(scenesPath(place));
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, [pageOneEarlier, pageOneLater, pageThree, noPage]);
    });

    test("is public, and answers an empty list for a script without scenes, a missing script or another movie's script", async () => {
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

    // changes in 04: the scoped list's tag filter has no caller (B5)
    test("filters by tags, matching all of them unless match=any", async () => {
        const place = await createMovieWithScript(api, cookie);
        const both = await createScene(api, cookie, place, { tags: [TAGS.protagonist, TAGS.revelation], start_time_seconds: 0, end_time_seconds: 10 });
        const one = await createScene(api, cookie, place, { tags: [TAGS.protagonist], start_time_seconds: 20, end_time_seconds: 30 });
        const other = await createScene(api, cookie, place, { tags: [TAGS.selfConflict], start_time_seconds: 40, end_time_seconds: 50 });
        const list = async (params) => ids((await api.get(`${scenesPath(place)}?${params}`)).body);

        assert.deepEqual(await list(query({ tags: `${TAGS.protagonist},${TAGS.revelation}` })), [both.id]);
        assert.deepEqual(await list(query({ tags: `${TAGS.protagonist},${TAGS.revelation}`, match: "sideways" })), [both.id]);
        assert.deepEqual(await list(query({ tags: `${TAGS.protagonist},${TAGS.revelation}`, match: "any" })), [both.id, one.id]);
        assert.deepEqual(
            await list(`${query({ tags: TAGS.revelation })}&${query({ tags: TAGS.selfConflict })}&match=any`),
            [both.id, other.id]
        );
        assert.deepEqual(await list("tags="), [both.id, one.id, other.id]);
    });

    test("gives each scene the earliest still with an image inside its film timing, edges included", async () => {
        const place = await createMovieWithScript(api, cookie);
        const { movie } = place;
        const middle = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120, page_start: 1, page_end: 1 });
        const startEdge = await createScene(api, cookie, place, { start_time_seconds: 200, end_time_seconds: 260, page_start: 2, page_end: 2 });
        const endEdge = await createScene(api, cookie, place, { start_time_seconds: 300, end_time_seconds: 360, page_start: 3, page_end: 3 });
        const empty = await createScene(api, cookie, place, { start_time_seconds: 400, end_time_seconds: 460, page_start: 4, page_end: 4 });

        await createStill(movie, 59, `annotations/${movie.id}/before.jpg`);
        await createStill(movie, 80); // no image
        const first = await createStill(movie, 100, `annotations/${movie.id}/first.jpg`);
        await createStill(movie, 110, `annotations/${movie.id}/second.jpg`);
        const atStart = await createStill(movie, 200, `annotations/${movie.id}/start.jpg`);
        const atEnd = await createStill(movie, 360, `annotations/${movie.id}/end.jpg`);
        await pool.query("UPDATE annotations SET thumb_key = $1 WHERE id = $2", [`annotations/${movie.id}/thumbs/first.jpg.webp`, first.id]);

        const byId = new Map((await api.get(scenesPath(place))).body.map((scene) => [scene.id, scene]));
        assert.deepEqual(byId.get(middle.id).first_image_annotation, {
            id: first.id,
            time_seconds: 100,
            image_key: first.image_key,
            thumb_key: `annotations/${movie.id}/thumbs/first.jpg.webp`,
            created_at: first.created_at,
        });
        assert.equal(byId.get(startEdge.id).first_image_annotation.id, atStart.id);
        assert.equal(byId.get(startEdge.id).first_image_annotation.thumb_key, null);
        assert.equal(byId.get(endEdge.id).first_image_annotation.id, atEnd.id);
        assert.equal(byId.get(empty.id).first_image_annotation, null);
    });
});

describe("searching captured scenes", () => {
    test("is public and returns scenes from every movie, most recently updated first, with the movie title and a signed script URL", async () => {
        const first = await createMovieWithScript(api, cookie);
        const second = await createMovieWithScript(api, cookie);
        const older = await createScene(api, cookie, first);
        const newer = await createScene(api, cookie, second);
        const touched = await api.put(`${scenesPath(first)}/${older.id}`, { cookie, body: { tags: [TAGS.revelation] } });
        assert.equal(touched.status, 200, touched.text);

        const response = await api.get("/script-scenes");
        assert.equal(response.status, 200);
        assert.deepEqual(onlyMine(response.body, [older, newer]), [older.id, newer.id]);

        const result = response.body.find((scene) => scene.id === older.id);
        const { movie_title: movieTitle, script_url: scriptUrl, ...scene } = result;
        assert.deepEqual(scene, touched.body);
        assert.equal(movieTitle, first.movie.title);
        // changes in 04: search results no longer sign script URLs (B3)
        assert.match(scriptUrl, signedUrlPattern(first.script.s3_key));
    });

    test("filters by tags, matching all of them unless match=any", async () => {
        const place = await createMovieWithScript(api, cookie);
        const both = await createScene(api, cookie, place, { tags: [TAGS.protagonist, TAGS.revelation], start_time_seconds: 0, end_time_seconds: 10 });
        const one = await createScene(api, cookie, place, { tags: [TAGS.revelation], start_time_seconds: 20, end_time_seconds: 30 });
        const other = await createScene(api, cookie, place, { tags: [TAGS.selfConflict], start_time_seconds: 40, end_time_seconds: 50 });
        const mine = [both, one, other];
        const search = async (params) => onlyMine((await api.get(`/script-scenes?${params}`)).body, mine);

        assert.deepEqual(await search(query({ tags: `${TAGS.protagonist},${TAGS.revelation}` })), [both.id]);
        assert.deepEqual(
            (await search(query({ tags: `${TAGS.protagonist},${TAGS.selfConflict}`, match: "any" }))).sort(),
            [both.id, other.id].sort()
        );
        assert.deepEqual((await search(`${query({ tags: TAGS.revelation })}&${query({ tags: TAGS.selfConflict })}&match=any`)).sort(), [both.id, one.id, other.id].sort());
    });

    // changes in 04: the movie_id, script_id and q filters and the request's limit are removed (B5)
    test("filters by movie_id, script_id and text, and takes a limit between 1 and 1000", async () => {
        const place = await createMovieWithScript(api, cookie);
        const other = await createMovieWithScript(api, cookie);
        const inSelected = await createScene(api, cookie, place, {
            selected_text: "A ZEBRA crosses.",
            formatted_selected_text: "Plain.",
            raw_selected_text: "Plain.",
            start_time_seconds: 0,
            end_time_seconds: 10,
        });
        const inFormatted = await createScene(api, cookie, place, {
            selected_text: "Plain.",
            formatted_selected_text: "The zebra waits.",
            raw_selected_text: "Plain.",
            start_time_seconds: 20,
            end_time_seconds: 30,
        });
        const inRaw = await createScene(api, cookie, place, {
            selected_text: "Plain.",
            formatted_selected_text: "Plain.",
            raw_selected_text: "zebras",
            start_time_seconds: 40,
            end_time_seconds: 50,
        });
        const elsewhere = await createScene(api, cookie, other, { raw_selected_text: "zebra elsewhere" });
        const search = async (params) => (await api.get(`/script-scenes?${query(params)}`)).body;

        const byMovie = await search({ movie_id: place.movie.id });
        assert.deepEqual(ids(byMovie), [inRaw.id, inFormatted.id, inSelected.id]);
        assert.deepEqual(ids(await search({ script_id: other.script.id })), [elsewhere.id]);
        assert.deepEqual(ids(await search({ movie_id: place.movie.id, q: "  zebra " })), [inRaw.id, inFormatted.id, inSelected.id]);
        assert.deepEqual(ids(await search({ movie_id: place.movie.id, q: "WAITS" })), [inFormatted.id]);

        assert.deepEqual(ids(await search({ movie_id: place.movie.id, limit: "1" })), [inRaw.id]);
        assert.deepEqual(ids(await search({ movie_id: place.movie.id, limit: "0" })), [inRaw.id]);
        assert.equal((await search({ movie_id: place.movie.id, limit: "many" })).length, 3);
        assert.equal((await search({ movie_id: place.movie.id, limit: "5000" })).length, 3);
    });
});
