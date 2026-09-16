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
    sceneAnchor:
        "Invalid body. Each scene anchor needs a whole page from 1 to 100000, a whole line from 0 to 100000, finite top and bottom, and text.",
    reversedPair: "Invalid body. The start anchor must come before or on the same line as the end anchor.",
    sceneText: "Invalid body. scene_text must be a non-empty string.",
    rawText: "Invalid body. raw_text must be a non-empty string.",
    tags: "Invalid body. tags must be an array of strings.",
    sceneNotFound: "Script scene annotation not found",
    scriptNotFound: "Script not found",
    filmTimingOverlap: "This scene's film timing overlaps another scene in this script.",
    scriptLocationOverlap: "This scene's script location shares lines with another scene in this script.",
};

const SCENE_FIELDS = [
    "created_at",
    "end_time_seconds",
    "first_image_annotation",
    "id",
    "movie_id",
    "raw_text",
    "scene_text",
    "script_id",
    "script_location",
    "start_time_seconds",
    "tags",
    "updated_at",
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
    return api.post(scenesPath(place), { cookie, body });
}

function putScene(place, sceneId, body) {
    return api.put(`${scenesPath(place)}/${sceneId}`, { cookie, body });
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
        assert.equal(response.body.raw_text, body.raw_text);
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
            [{ ...valid, raw_text: "" }, MESSAGES.rawText],
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

    test("requires bounded, finite anchors and permits empty anchor text", async () => {
        const place = await newPlace();
        const pair = anchorPair();
        for (const start of [
            { ...pair.start, page: 100_001 },
            { ...pair.start, line: -1 },
            { ...pair.start, line: 100_001 },
            { ...pair.start, top: null },
            { ...pair.start, bottom: "1" },
            { ...pair.start, text: null },
        ]) {
            await expectError(
                postScene(place, sceneBody({ script_location: { start, end: pair.end } })),
                400,
                MESSAGES.sceneAnchor
            );
        }
        const response = await postScene(
            place,
            sceneBody({ script_location: { start: { ...pair.start, text: "" }, end: pair.end } })
        );
        assert.equal(response.status, 201, response.text);
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
    test("film timing rejects overlap, allows touching, and checks it before script location", async () => {
        const place = await newPlace();
        const saved = await createScene(api, cookie, place, { start_time_seconds: 10, end_time_seconds: 20 });
        await expectError(
            postScene(place, sceneBody({ start_time_seconds: 15, end_time_seconds: 25 })),
            409,
            MESSAGES.filmTimingOverlap,
            expectedConflict("film_timing", saved)
        );
        const touching = await postScene(
            place,
            sceneBody({ start_time_seconds: 20, end_time_seconds: 30, script_location: anchorPair({ startLine: 50 }) })
        );
        assert.equal(touching.status, 201, touching.text);
    });

    test("a zero-length timing overlaps only a scene that strictly contains it", async () => {
        const place = await newPlace();
        const saved = await createScene(api, cookie, place, { start_time_seconds: 10, end_time_seconds: 20 });
        await expectError(
            postScene(place, sceneBody({ start_time_seconds: 15, end_time_seconds: 15, script_location: anchorPair({ startLine: 50 }) })),
            409,
            MESSAGES.filmTimingOverlap,
            expectedConflict("film_timing", saved)
        );
        assert.equal(
            (
                await postScene(
                    place,
                    sceneBody({ start_time_seconds: 20, end_time_seconds: 20, script_location: anchorPair({ startLine: 60 }) })
                )
            ).status,
            201
        );
    });

    test("script locations reject a shared line and allow adjacent lines", async () => {
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
            raw_text: "Changed raw text",
            tags: [TAGS.revelation],
            script_location: anchorPair({ startPage: 3, startLine: 1 }),
        });
        const response = await putScene(place, saved.id, body);
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.id, saved.id);
        assert.equal(response.body.created_at, saved.created_at);
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
    async function insertDirect(db, place, { id = randomUUID(), timing = [100, 110], location = anchorPair({ startLine: 500 }) } = {}) {
        await db.query(
            `INSERT INTO captured_scenes (
               id, script_id, start_time_seconds, end_time_seconds,
               start_page, start_line, start_top, start_bottom, start_text,
               end_page, end_line, end_top, end_bottom, end_text, scene_text, raw_text, tags
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Text','Text','[]')`,
            [
                id,
                place.script.id,
                ...timing,
                location.start.page,
                location.start.line,
                location.start.top,
                location.start.bottom,
                location.start.text,
                location.end.page,
                location.end.line,
                location.end.top,
                location.end.bottom,
                location.end.text,
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
        const shared = anchorPair({ startLine: 700, endLine: 704 });
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
    test("the advisory lock lets one save win and makes the other a named 409", async () => {
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
                        script_location: anchorPair({ startLine: 800 }),
                    })
                ),
                postScene(
                    place,
                    sceneBody({
                        start_time_seconds: 10,
                        end_time_seconds: 20,
                        script_location: anchorPair({ startLine: 900 }),
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
