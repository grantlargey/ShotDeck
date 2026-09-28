import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pool } from "../src/db.js";
import { signInOwner, startApi } from "./helpers/api.js";
import { anchorPair, createMovieWithScript, createScene, sceneBody, scenesPath, TAGS } from "./helpers/fixtures.js";

const api = await startApi();
const { cookie } = await signInOwner(api);

const MESSAGES = {
    filmTiming:
        "Invalid body. start_time_seconds and end_time_seconds must be integers between 0 and 2147483647 where end >= start.",
    scriptLocation: "Invalid body. script_location must contain start and end scene anchors.",
    sceneAnchor: "Invalid body. Each scene anchor needs a whole page from 1 to 300 and a y from 0 to 1000.",
    reversedPair: "Invalid body. The start anchor must come before or at the end anchor.",
    sceneText: "Invalid body. scene_text must be a non-empty string.",
    tags: "Invalid body. tags must be an array of strings.",
    sceneNotFound: "Script scene annotation not found",
    scriptNotFound: "Script not found",
    filmTimingOverlap: "This scene's film timing shares a second with another scene in this script.",
    scriptLocationOverlap: "This scene's script location overlaps another scene in this script.",
};

const SCENE_FIELDS = [
    "end_time_seconds",
    "first_image_annotation",
    "id",
    "movie_id",
    "scene_text",
    "script_id",
    "script_location",
    "start_time_seconds",
    "tags",
];

function without(body, ...fields) {
    const copy = { ...body };
    for (const field of fields) delete copy[field];
    return copy;
}

async function newPlace() {
    return createMovieWithScript(api, cookie);
}

function postScene(place, body) {
    return api.post(scenesPath(place), { cookie, body: { script_key: place.script.s3_key, ...body } });
}

function putScene(place, sceneId, body) {
    return api.put(`${scenesPath(place)}/${sceneId}`, { cookie, body: { script_key: place.script.s3_key, ...body } });
}

async function expectError(responsePromise, status, error, details = {}) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error, ...details });
}

async function waitForLockWaiters(count) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
        const result = await pool.query(
            `SELECT count(*)::int AS waiting FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'`
        );
        if (result.rows[0].waiting >= count) return;
        await delay(10);
    }
    assert.fail(`${count} requests never waited on a lock`);
}

function expectedConflict(kind, scene) {
    return {
        conflict_kind: kind,
        conflict_scene_id: scene.id,
        conflict_start_time_seconds: scene.start_time_seconds,
        conflict_end_time_seconds: scene.end_time_seconds,
    };
}

describe("creating a captured scene", () => {
    test("returns the canonical response shape", async () => {
        const place = await newPlace();
        const body = sceneBody();
        const response = await postScene(place, body);
        assert.equal(response.status, 201, response.text);
        assert.deepEqual(Object.keys(response.body).sort(), SCENE_FIELDS);
        assert.equal(response.body.movie_id, place.movie.id);
        assert.equal(response.body.script_id, place.script.id);
        assert.deepEqual(response.body.script_location, body.script_location);
        assert.equal(response.body.scene_text, body.scene_text);
        assert.deepEqual(response.body.tags, body.tags);
        assert.equal(response.body.first_image_annotation, null);
    });

    test("requires authentication before reading the body", async () => {
        const place = await newPlace();
        await expectError(api.post(scenesPath(place), { body: {} }), 401, "Sign in to make changes.");
    });

    test("validates fields in the canonical order", async () => {
        const place = await newPlace();
        const valid = sceneBody();
        const invalid = [
            [without(valid, "start_time_seconds"), MESSAGES.filmTiming],
            [without(valid, "script_location"), MESSAGES.scriptLocation],
            [{ ...valid, script_location: { start: { ...valid.script_location.start, page: 0 }, end: valid.script_location.end } }, MESSAGES.sceneAnchor],
            [{ ...valid, script_location: anchorPair({ startLine: 20, endLine: 10 }) }, MESSAGES.reversedPair],
            [{ ...valid, scene_text: " \n\t " }, MESSAGES.sceneText],
            [without(valid, "tags"), MESSAGES.tags],
        ];
        for (const [body, message] of invalid) await expectError(postScene(place, body), 400, message);
    });

    test("bounds film timing to PostgreSQL integers and allows zero-length timing", async () => {
        const place = await newPlace();
        for (const fields of [
            { start_time_seconds: -1 },
            { start_time_seconds: 1.5 },
            { start_time_seconds: "1" },
            { start_time_seconds: 10, end_time_seconds: 9 },
            { end_time_seconds: 2_147_483_648 },
        ]) {
            await expectError(postScene(place, sceneBody(fields)), 400, MESSAGES.filmTiming);
        }
        assert.equal(
            (await postScene(place, sceneBody({ start_time_seconds: 5, end_time_seconds: 5 }))).status,
            201
        );
    });

    test("requires a bounded page and a finite baseline within the page", async () => {
        const place = await newPlace();
        const pair = anchorPair();
        for (const start of [
            { ...pair.start, page: 301 },
            { ...pair.start, page: 0 },
            { ...pair.start, y: -0.1 },
            { ...pair.start, y: 1000.1 },
            { ...pair.start, y: null },
            { ...pair.start, y: "1" },
        ]) {
            await expectError(
                postScene(place, sceneBody({ script_location: { start, end: pair.end } })),
                400,
                MESSAGES.sceneAnchor
            );
        }
        // The page's whole height is in range, and a fractional baseline is kept.
        const response = await postScene(
            place,
            sceneBody({ script_location: { start: { page: 1, y: 0 }, end: { page: 1, y: 1000 } } })
        );
        assert.equal(response.status, 201, response.text);
        assert.deepEqual(response.body.script_location, { start: { page: 1, y: 0 }, end: { page: 1, y: 1000 } });
    });

    test("trims, drops blanks and deduplicates taxonomy tags in first-seen order", async () => {
        const response = await postScene(
            await newPlace(),
            sceneBody({ tags: [` ${TAGS.revelation} `, "", TAGS.protagonist, TAGS.revelation] })
        );
        assert.deepEqual(response.body.tags, [TAGS.revelation, TAGS.protagonist]);
    });

    test("rejects malformed and unknown tags, naming the first unknown value", async () => {
        const place = await newPlace();
        await expectError(postScene(place, sceneBody({ tags: "x" })), 400, MESSAGES.tags);
        await expectError(
            postScene(place, sceneBody({ tags: ["unknown:first", "unknown:second"] })),
            400,
            "Invalid body. Unknown script tag: unknown:first"
        );
    });

    test("ignores removed legacy fields instead of aliasing them", async () => {
        const body = sceneBody({
            anchor_geometry: [{ kind: "start" }],
            selected_text: "legacy selected",
            formatted_selected_text: "legacy formatted",
            raw_selected_text: "legacy raw",
            page_start: 99,
            page_end: 100,
            context_prefix: "legacy",
            start_offset: 10,
        });
        const response = await postScene(await newPlace(), body);
        assert.equal(response.status, 201, response.text);
        assert.equal(response.body.scene_text, body.scene_text);
        for (const field of ["anchor_geometry", "selected_text", "formatted_selected_text", "page_start"]) {
            assert.ok(!(field in response.body));
        }
    });

    test("checks script ownership only after body validation", async () => {
        const place = await newPlace();
        const missing = { movie: place.movie, script: { id: randomUUID() } };
        await expectError(postScene(missing, sceneBody()), 404, MESSAGES.scriptNotFound);
        await expectError(postScene(missing, {}), 400, MESSAGES.filmTiming);
    });
});

describe("overlap rules", () => {
    test("film timing rejects overlap and touching, and checks it before script location", async () => {
        const place = await newPlace();
        const saved = await createScene(api, cookie, place, { start_time_seconds: 10, end_time_seconds: 20 });
        await expectError(
            postScene(place, sceneBody({ start_time_seconds: 15, end_time_seconds: 25 })),
            409,
            MESSAGES.filmTimingOverlap,
            expectedConflict("film_timing", saved)
        );
        await expectError(
            postScene(place, sceneBody({ start_time_seconds: 20, end_time_seconds: 30, script_location: anchorPair({ startLine: 50 }) })),
            409,
            MESSAGES.filmTimingOverlap,
            expectedConflict("film_timing", saved)
        );
        const clear = await postScene(
            place,
            sceneBody({ start_time_seconds: 21, end_time_seconds: 30, script_location: anchorPair({ startLine: 50 }) })
        );
        assert.equal(clear.status, 201, clear.text);
    });

    test("a zero-length timing conflicts with any scene covering its second", async () => {
        const place = await newPlace();
        const saved = await createScene(api, cookie, place, { start_time_seconds: 10, end_time_seconds: 20 });
        await expectError(
            postScene(place, sceneBody({ start_time_seconds: 15, end_time_seconds: 15, script_location: anchorPair({ startLine: 50 }) })),
            409,
            MESSAGES.filmTimingOverlap,
            expectedConflict("film_timing", saved)
        );
        await expectError(
            postScene(place, sceneBody({ start_time_seconds: 20, end_time_seconds: 20, script_location: anchorPair({ startLine: 60 }) })),
            409,
            MESSAGES.filmTimingOverlap,
            expectedConflict("film_timing", saved)
        );
        assert.equal(
            (
                await postScene(
                    place,
                    sceneBody({ start_time_seconds: 21, end_time_seconds: 21, script_location: anchorPair({ startLine: 60 }) })
                )
            ).status,
            201
        );
    });

    test("script locations reject a shared baseline and allow adjacent lines", async () => {
        const place = await newPlace();
        const saved = await createScene(api, cookie, place, {
            start_time_seconds: 0,
            end_time_seconds: 10,
            script_location: anchorPair({ startPage: 2, startLine: 10, endLine: 20 }),
        });
        await expectError(
            postScene(
                place,
                sceneBody({
                    start_time_seconds: 20,
                    end_time_seconds: 30,
                    script_location: anchorPair({ startPage: 2, startLine: 20, endLine: 25 }),
                })
            ),
            409,
            MESSAGES.scriptLocationOverlap,
            expectedConflict("script_location", saved)
        );
        assert.equal(
            (
                await postScene(
                    place,
                    sceneBody({
                        start_time_seconds: 40,
                        end_time_seconds: 50,
                        script_location: anchorPair({ startPage: 2, startLine: 21, endLine: 25 }),
                    })
                )
            ).status,
            201
        );
    });
});

describe("updating and deleting a captured scene", () => {
    test("update replaces the whole canonical scene without conflicting with itself", async () => {
        const place = await newPlace();
        const saved = await createScene(api, cookie, place);
        const body = sceneBody({
            start_time_seconds: 30,
            end_time_seconds: 40,
            scene_text: "Changed scene text",
            tags: [TAGS.revelation],
            script_location: anchorPair({ startPage: 3, startLine: 1 }),
        });
        const response = await putScene(place, saved.id, body);
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.id, saved.id);
        assert.equal(response.body.scene_text, body.scene_text);
        assert.deepEqual(response.body.script_location, body.script_location);
    });

    test("update and delete are scoped through the script's movie", async () => {
        const place = await newPlace();
        const other = await newPlace();
        const saved = await createScene(api, cookie, place);
        await expectError(putScene(other, saved.id, sceneBody()), 404, MESSAGES.sceneNotFound);
        await expectError(api.delete(`${scenesPath(other)}/${saved.id}`, { cookie }), 404, MESSAGES.sceneNotFound);
        assert.equal((await api.delete(`${scenesPath(place)}/${saved.id}`, { cookie })).status, 204);
        await expectError(api.delete(`${scenesPath(place)}/${saved.id}`, { cookie }), 404, MESSAGES.sceneNotFound);
    });
});

describe("database overlap constraints", () => {
    async function insertDirect(db, place, { id = randomUUID(), timing = [100, 110], location = anchorPair({ startLine: 50 }) } = {}) {
        await db.query(
            `INSERT INTO captured_scenes (
               id, script_id, start_time_seconds, end_time_seconds,
               start_page, start_y, end_page, end_y, scene_text, tags
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Text','[]')`,
            [
                id,
                place.script.id,
                ...timing,
                location.start.page,
                location.start.y,
                location.end.page,
                location.end.y,
            ]
        );
        return id;
    }

    test("a constraint race maps film timing to a 409 with null conflict details", async () => {
        const place = await newPlace();
        const holder = await pool.connect();
        try {
            await holder.query("BEGIN");
            await insertDirect(holder, place, { timing: [10, 20] });
            const request = postScene(place, sceneBody({ start_time_seconds: 15, end_time_seconds: 25 }));
            await waitForLockWaiters(1);
            await holder.query("COMMIT");
            await expectError(request, 409, MESSAGES.filmTimingOverlap, {
                conflict_kind: "film_timing",
                conflict_scene_id: null,
                conflict_start_time_seconds: null,
                conflict_end_time_seconds: null,
            });
        } finally {
            await holder.query("ROLLBACK").catch(() => {});
            holder.release();
        }
    });

    test("a constraint race maps script location to a 409 with null conflict details", async () => {
        const place = await newPlace();
        const shared = anchorPair({ startLine: 60, endLine: 64 });
        const holder = await pool.connect();
        try {
            await holder.query("BEGIN");
            await insertDirect(holder, place, { timing: [10, 20], location: shared });
            const request = postScene(
                place,
                sceneBody({ start_time_seconds: 30, end_time_seconds: 40, script_location: shared })
            );
            await waitForLockWaiters(1);
            await holder.query("COMMIT");
            await expectError(request, 409, MESSAGES.scriptLocationOverlap, {
                conflict_kind: "script_location",
                conflict_scene_id: null,
                conflict_start_time_seconds: null,
                conflict_end_time_seconds: null,
            });
        } finally {
            await holder.query("ROLLBACK").catch(() => {});
            holder.release();
        }
    });
});

describe("concurrent zero-length saves", () => {
    test("the film write lock lets one save win and makes the other a named 409", async () => {
        const place = await newPlace();
        const blocker = await pool.connect();
        let pending = [];
        try {
            await blocker.query("BEGIN");
            await blocker.query("LOCK TABLE captured_scenes IN EXCLUSIVE MODE");
            pending = [
                postScene(
                    place,
                    sceneBody({
                        start_time_seconds: 15,
                        end_time_seconds: 15,
                        script_location: anchorPair({ startLine: 20 }),
                    })
                ),
                postScene(
                    place,
                    sceneBody({
                        start_time_seconds: 10,
                        end_time_seconds: 20,
                        script_location: anchorPair({ startLine: 40 }),
                    })
                ),
            ];
            await waitForLockWaiters(2);
            await blocker.query("COMMIT");
            const responses = await Promise.all(pending);
            assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
            const stored = responses.find((response) => response.status === 201).body;
            const refused = responses.find((response) => response.status === 409).body;
            assert.deepEqual(refused, {
                error: MESSAGES.filmTimingOverlap,
                ...expectedConflict("film_timing", stored),
            });
            assert.deepEqual((await api.get(scenesPath(place))).body.map((scene) => scene.id), [stored.id]);
        } finally {
            await blocker.query("ROLLBACK").catch(() => {});
            blocker.release();
            await Promise.allSettled(pending);
        }
    });
});


describe("the captured PDF precondition", () => {
    test("a replaced PDF refuses a stale tab, while a same-key retry keeps the draft valid", async () => {
        const place = await newPlace();
        const savePdf = (key) => api.post(`/movies/${place.movie.id}/scripts`, { cookie, body: { s3_key: key } });
        await savePdf(place.script.s3_key);
        const saved = await postScene(place, sceneBody());
        assert.equal(saved.status, 201, saved.text);
        const replacement = await savePdf(`scripts/${place.movie.id}/replacement.pdf`);
        assert.equal(replacement.status, 201, replacement.text);
        await expectError(postScene(place, sceneBody()), 409,
            "The script PDF has changed. Reload it before saving a scene.");
        assert.deepEqual((await api.get(scenesPath(place))).body, []);
        place.script = replacement.body;
        assert.equal((await postScene(place, sceneBody())).status, 201);
    });

    test("requires the captured PDF key rather than silently trusting script identity", async () => {
        const place = await newPlace();
        await expectError(api.post(scenesPath(place), { cookie, body: sceneBody() }), 400,
            "Reload the script before saving a scene.");
    });

    test("a save waiting behind replacement rechecks the PDF after acquiring the lock", async () => {
        const place = await newPlace();
        const holder = await pool.connect();
        let request;
        try {
            await holder.query("BEGIN");
            await holder.query("SELECT id FROM movies WHERE id = $1 FOR NO KEY UPDATE", [place.movie.id]);
            request = postScene(place, sceneBody());
            await waitForLockWaiters(1);
            await holder.query("UPDATE scripts SET s3_key = $2 WHERE id = $1",
                [place.script.id, `scripts/${place.movie.id}/replacement.pdf`]);
            await holder.query("COMMIT");
            await expectError(request, 409, "The script PDF has changed. Reload it before saving a scene.");
            assert.deepEqual((await api.get(scenesPath(place))).body, []);
        } finally {
            await holder.query("ROLLBACK").catch(() => {});
            holder.release();
            await request;
        }
    });
});
