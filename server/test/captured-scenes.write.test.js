import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { signInOwner, startApi } from "./helpers/api.js";
import {
    anchorPair,
    createMovieWithScript,
    createScene,
    sceneBody,
    scenesPath,
    TAGS,
} from "./helpers/fixtures.js";
import { pool } from "../src/db.js";

/*
 * Characterization of captured-scene writes:
 * POST, PUT and DELETE /movies/:movieId/scripts/:scriptId/scene-annotations.
 *
 * "changes in NN" marks behavior that overhaul issue NN is expected to change.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const MESSAGES = {
    filmTiming:
        "Invalid body. start_time_seconds and end_time_seconds must be integers where end >= start and start >= 0.",
    pages: "Invalid body. page_start/page_end must be positive integers and page_end >= page_start.",
    context: "Invalid body. context_prefix/context_suffix must be strings when provided.",
    offsets: "Invalid body. start_offset/end_offset must be integers where end_offset >= start_offset >= 0.",
    rawText: "Invalid body. raw_selected_text must be a non-empty string.",
    tags: "Invalid body. tags must be an array of strings.",
    geometry: "Invalid body. anchor_geometry must be a JSON array when provided.",
    sceneAnchor:
        "Invalid body. A version-2 anchor_geometry entry needs kind start or end, version 2, unit pt, a whole page >= 1, a whole line >= 0, finite top and bottom, and text.",
    reversedPair: "Invalid body. The start anchor must come before or on the same line as the end anchor.",
    sceneNotFound: "Script scene annotation not found",
    scriptNotFound: "Script not found",
    filmTimingOverlap: "This scene's film timing overlaps another scene in this script.",
    scriptLocationOverlap: "This scene's script location shares lines with another scene in this script.",
};

// changes in 11: anchor_id, the text fields, offsets and context
const SCENE_FIELDS = [
    "anchor_geometry",
    "anchor_id",
    "context_prefix",
    "context_suffix",
    "created_at",
    "end_offset",
    "end_time_seconds",
    "first_image_annotation",
    "formatted_selected_text",
    "id",
    "movie_id",
    "page_end",
    "page_start",
    "raw_selected_text",
    "script_id",
    "selected_text",
    "start_offset",
    "start_time_seconds",
    "tags",
    "updated_at",
];

const LOCATION_FIELDS = [
    "page_start",
    "page_end",
    "selected_text",
    "raw_selected_text",
    "formatted_selected_text",
    "context_prefix",
    "context_suffix",
    "start_offset",
    "end_offset",
    "anchor_geometry",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

/** Takes the script's captured-scene lock, with the same key the module uses. */
const LOCK_SCRIPT_SCENES_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('captured-scenes:' || $1::uuid::text, 0))";

/** Waits until at least `count` sessions wait on a lock, of the `waitEvent` kind ("advisory", say) when given. */
async function waitForLockWaiters(count, waitEvent = null) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
        const { rows } = await pool.query(
            `SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND ($1::text IS NULL OR wait_event = $1)`,
            [waitEvent]
        );
        if (rows[0].waiting >= count) return;
        await delay(10);
    }
    assert.fail(`${count} requests never waited on a${waitEvent ? `n ${waitEvent}` : ""} lock`);
}

/**
 * Sends a body with every field invalid, then repairs one field at a time, and
 * checks that each 400 names the next field in the fixed order.
 */
async function expectFieldOrder(send) {
    const order = [
        ["start_time_seconds", -1, MESSAGES.filmTiming],
        ["page_start", 0, MESSAGES.pages],
        ["context_prefix", 1, MESSAGES.context],
        ["start_offset", -1, MESSAGES.offsets],
        ["raw_selected_text", "", MESSAGES.rawText],
        ["tags", 5, MESSAGES.tags],
        ["anchor_geometry", 5, MESSAGES.geometry],
    ];
    let body = sceneBody(Object.fromEntries(order.map(([field, value]) => [field, value])));
    for (const [field, , message] of order) {
        await expectError(send(body), 400, message);
        body = { ...body, [field]: sceneBody()[field] };
    }
}

/** Creates a scene from `body` in a fresh script and returns the saved scene. */
async function saveInNewPlace(body) {
    const response = await postScene(await newPlace(), body);
    assert.equal(response.status, 201, response.text);
    return response.body;
}

describe("creating a captured scene", () => {
    test("returns 201 with the scene and its script location, with no nested `anchor` object", async () => {
        const place = await newPlace();
        const body = sceneBody();
        const response = await postScene(place, body);

        assert.equal(response.status, 201, response.text);
        const scene = response.body;
        assert.deepEqual(Object.keys(scene).sort(), SCENE_FIELDS);
        assert.match(scene.id, UUID);
        assert.match(scene.anchor_id, UUID);
        assert.notEqual(scene.id, scene.anchor_id);
        assert.equal(scene.movie_id, place.movie.id);
        assert.equal(scene.script_id, place.script.id);
        assert.equal(scene.start_time_seconds, 60);
        assert.equal(scene.end_time_seconds, 120);
        assert.deepEqual(scene.tags, body.tags);
        for (const field of LOCATION_FIELDS) assert.deepEqual(scene[field], body[field], field);
        assert.equal(scene.first_image_annotation, null);
        assert.ok(!Number.isNaN(Date.parse(scene.created_at)));
        assert.ok(!Number.isNaN(Date.parse(scene.updated_at)));
    });

    test("requires the sign-in cookie", async () => {
        const place = await newPlace();
        await expectError(api.post(scenesPath(place), { body: sceneBody() }), 401, "Sign in to make changes.");
    });

    test("with no body at all is a 400 about film timing", async () => {
        const place = await newPlace();
        await expectError(api.post(scenesPath(place), { cookie }), 400, MESSAGES.filmTiming);
    });

    test("answers 404 when the script isn't the movie's, but only after the body is valid", async () => {
        const place = await newPlace();
        const other = await newPlace();
        const wrongScript = { movie: place.movie, script: other.script };
        const missingScript = { movie: place.movie, script: { id: randomUUID() } };

        await expectError(postScene(wrongScript, sceneBody()), 404, MESSAGES.scriptNotFound);
        await expectError(postScene(missingScript, sceneBody()), 404, MESSAGES.scriptNotFound);
        await expectError(postScene(missingScript, without(sceneBody(), "start_time_seconds")), 400, MESSAGES.filmTiming);
    });

    describe("film timing", () => {
        test("must be whole seconds with start >= 0 and end >= start", async () => {
            const place = await newPlace();
            const invalid = [
                without(sceneBody(), "start_time_seconds"),
                without(sceneBody(), "end_time_seconds"),
                sceneBody({ start_time_seconds: "abc" }),
                sceneBody({ start_time_seconds: 1.5 }),
                sceneBody({ start_time_seconds: -1, end_time_seconds: 10 }),
                sceneBody({ start_time_seconds: 30, end_time_seconds: 20 }),
                sceneBody({ end_time_seconds: {} }),
            ];
            for (const body of invalid) {
                await expectError(postScene(place, body), 400, MESSAGES.filmTiming);
            }
        });

        test("must be JSON numbers: numeric strings, null and empty strings are a 400", async () => {
            const place = await newPlace();
            const invalid = [
                sceneBody({ start_time_seconds: "15", end_time_seconds: "30" }),
                sceneBody({ start_time_seconds: null, end_time_seconds: 5 }),
                sceneBody({ start_time_seconds: "", end_time_seconds: "" }),
            ];
            for (const body of invalid) {
                await expectError(postScene(place, body), 400, MESSAGES.filmTiming);
            }
        });
    });

    describe("pages", () => {
        test("must be positive whole numbers with page_end >= page_start", async () => {
            const place = await newPlace();
            const invalid = [
                sceneBody({ page_start: 0 }),
                sceneBody({ page_end: -1 }),
                sceneBody({ page_start: 1.5 }),
                sceneBody({ page_start: "abc" }),
                sceneBody({ page_start: 3, page_end: 2 }),
            ];
            for (const body of invalid) {
                await expectError(postScene(place, body), 400, MESSAGES.pages);
            }
        });

        test("are stored as null when missing or null", async () => {
            const missing = await saveInNewPlace(without(sceneBody(), "page_start", "page_end"));
            assert.equal(missing.page_start, null);
            assert.equal(missing.page_end, null);

            const nulls = await saveInNewPlace(sceneBody({ page_start: null, page_end: 4 }));
            assert.equal(nulls.page_start, null);
            assert.equal(nulls.page_end, 4);
        });

        test("must be JSON numbers: numeric and empty strings are a 400", async () => {
            const place = await newPlace();
            for (const body of [sceneBody({ page_start: "2", page_end: "3" }), sceneBody({ page_start: "", page_end: "" })]) {
                await expectError(postScene(place, body), 400, MESSAGES.pages);
            }
        });
    });

    // changes in 11: offsets and context are removed (A6)
    describe("offsets and context", () => {
        test("offsets must be whole numbers with end_offset >= start_offset >= 0", async () => {
            const place = await newPlace();
            const invalid = [
                sceneBody({ start_offset: -1 }),
                sceneBody({ end_offset: 1.5 }),
                sceneBody({ start_offset: "x" }),
                sceneBody({ start_offset: 10, end_offset: 5 }),
            ];
            for (const body of invalid) {
                await expectError(postScene(place, body), 400, MESSAGES.offsets);
            }
        });

        test("offsets are null when missing or null, and numeric or empty strings are a 400", async () => {
            const missing = await saveInNewPlace(without(sceneBody(), "start_offset", "end_offset"));
            assert.equal(missing.start_offset, null);
            assert.equal(missing.end_offset, null);

            const nulls = await saveInNewPlace(sceneBody({ start_offset: null, end_offset: null }));
            assert.equal(nulls.start_offset, null);
            assert.equal(nulls.end_offset, null);

            const place = await newPlace();
            for (const body of [sceneBody({ start_offset: "5", end_offset: "9" }), sceneBody({ start_offset: null, end_offset: "" })]) {
                await expectError(postScene(place, body), 400, MESSAGES.offsets);
            }
        });

        test("context must be a string or null", async () => {
            const place = await newPlace();
            for (const body of [sceneBody({ context_prefix: 5 }), sceneBody({ context_suffix: {} })]) {
                await expectError(postScene(place, body), 400, MESSAGES.context);
            }
        });

        test("context is null when missing or null, and an empty string is kept", async () => {
            const missing = await saveInNewPlace(without(sceneBody(), "context_prefix", "context_suffix"));
            assert.equal(missing.context_prefix, null);
            assert.equal(missing.context_suffix, null);

            const kept = await saveInNewPlace(sceneBody({ context_prefix: null, context_suffix: "" }));
            assert.equal(kept.context_prefix, null);
            assert.equal(kept.context_suffix, "");
        });
    });

    // changes in 11: one scene text field and one raw text field (A4)
    describe("scene text and raw text", () => {
        test("raw text must be non-blank, and it falls back to selected_text only when it isn't a string", async () => {
            const place = await newPlace();
            const invalid = [
                without(sceneBody(), "raw_selected_text", "selected_text"),
                sceneBody({ raw_selected_text: "" }),
                sceneBody({ raw_selected_text: "   " }),
                sceneBody({ raw_selected_text: null, selected_text: null }),
            ];
            for (const body of invalid) {
                await expectError(postScene(place, body), 400, MESSAGES.rawText);
            }

            const missing = await saveInNewPlace(without(sceneBody({ selected_text: "Selected" }), "raw_selected_text"));
            assert.equal(missing.raw_selected_text, "Selected");
            const nulled = await saveInNewPlace(sceneBody({ raw_selected_text: null, selected_text: "Selected" }));
            assert.equal(nulled.raw_selected_text, "Selected");
            const number = await saveInNewPlace(sceneBody({ raw_selected_text: 5, selected_text: "Selected" }));
            assert.equal(number.raw_selected_text, "Selected");
        });

        test("formatted text is kept when it is a string, even empty, and is null otherwise", async () => {
            assert.equal((await saveInNewPlace(sceneBody({ formatted_selected_text: "" }))).formatted_selected_text, "");
            assert.equal((await saveInNewPlace(sceneBody({ formatted_selected_text: null }))).formatted_selected_text, null);
            assert.equal((await saveInNewPlace(sceneBody({ formatted_selected_text: 5 }))).formatted_selected_text, null);
            const missing = await saveInNewPlace(without(sceneBody(), "formatted_selected_text"));
            assert.equal(missing.formatted_selected_text, null);
        });

        test("selected text falls back to formatted text, then raw text, when it is blank or not a string", async () => {
            const toFormatted = await saveInNewPlace(
                sceneBody({ selected_text: "  ", formatted_selected_text: "Formatted", raw_selected_text: "Raw" })
            );
            assert.equal(toFormatted.selected_text, "Formatted");

            const toRaw = await saveInNewPlace(
                sceneBody({ selected_text: null, formatted_selected_text: " ", raw_selected_text: "Raw" })
            );
            assert.equal(toRaw.selected_text, "Raw");

            const missing = await saveInNewPlace(
                without(sceneBody({ raw_selected_text: "Raw" }), "selected_text", "formatted_selected_text")
            );
            assert.equal(missing.selected_text, "Raw");

            const kept = await saveInNewPlace(
                sceneBody({ selected_text: "Selected", formatted_selected_text: "Formatted" })
            );
            assert.equal(kept.selected_text, "Selected");
        });
    });

    describe("tags", () => {
        test("are an empty list when missing or null", async () => {
            assert.deepEqual((await saveInNewPlace(without(sceneBody(), "tags"))).tags, []);
            assert.deepEqual((await saveInNewPlace(sceneBody({ tags: null }))).tags, []);
        });

        test("are trimmed, blanks dropped, duplicates and order kept", async () => {
            const scene = await saveInNewPlace(
                sceneBody({ tags: [` ${TAGS.revelation} `, "", TAGS.protagonist, TAGS.revelation] })
            );
            assert.deepEqual(scene.tags, [TAGS.revelation, TAGS.protagonist, TAGS.revelation]);
        });

        // changes in 11: only taxonomy tags are accepted (A9)
        test("accept values outside the tag taxonomy", async () => {
            const scene = await saveInNewPlace(sceneBody({ tags: ["Diner", TAGS.protagonist] }));
            assert.deepEqual(scene.tags, ["Diner", TAGS.protagonist]);
        });

        test("that aren't a list of strings are a 400, including a comma-separated string", async () => {
            const place = await newPlace();
            const invalid = [`${TAGS.protagonist}, ${TAGS.revelation}`, "", ["Diner", 7], [null], 5, { tag: TAGS.protagonist }, true];
            for (const tags of invalid) {
                await expectError(postScene(place, sceneBody({ tags })), 400, MESSAGES.tags);
            }
        });
    });

    describe("anchor geometry", () => {
        test("is an empty list when missing or null", async () => {
            assert.deepEqual((await saveInNewPlace(without(sceneBody(), "anchor_geometry"))).anchor_geometry, []);
            assert.deepEqual((await saveInNewPlace(sceneBody({ anchor_geometry: null }))).anchor_geometry, []);
        });

        test("that isn't a list is a 400, including a JSON string holding one", async () => {
            const place = await newPlace();
            for (const anchorGeometry of [JSON.stringify(anchorPair()), "  ", "", "not json", '{"page":1}', { page: 1 }, 5]) {
                await expectError(postScene(place, sceneBody({ anchor_geometry: anchorGeometry })), 400, MESSAGES.geometry);
            }
        });

        test("with a malformed version-2 scene anchor is a 400", async () => {
            const place = await newPlace();
            const [start, end] = anchorPair();
            const malformed = [
                { ...start, kind: "middle" },
                without(start, "kind"),
                { ...start, version: 3 },
                { ...start, version: "2" },
                without(start, "version"),
                { ...start, unit: "px" },
                { ...start, page: 0 },
                { ...start, page: 1.5 },
                { ...start, page: "1" },
                { ...start, line: -1 },
                { ...start, line: "0" },
                { ...start, top: "100" },
                { ...start, bottom: null },
                { ...start, text: 5 },
                without(start, "text"),
            ];
            for (const entry of malformed) {
                await expectError(postScene(place, sceneBody({ anchor_geometry: [entry, end] })), 400, MESSAGES.sceneAnchor);
            }
            await expectError(postScene(place, sceneBody({ anchor_geometry: [start, { ...end, kind: "End" }] })), 400, MESSAGES.sceneAnchor);
        });

        test("with a start anchor after its end anchor is a 400, and both on one line is fine", async () => {
            const place = await newPlace();
            const reversed = [
                anchorPair({ startPage: 1, startLine: 9, endLine: 3 }),
                anchorPair({ startPage: 3, startLine: 0, endPage: 2, endLine: 40 }),
                // A repeated kind's last valid entry is the one that counts.
                [...anchorPair({ startPage: 1, startLine: 0, endLine: 4 }), anchorPair({ startPage: 1, startLine: 8 })[0]],
            ];
            for (const anchorGeometry of reversed) {
                await expectError(postScene(place, sceneBody({ anchor_geometry: anchorGeometry })), 400, MESSAGES.reversedPair);
            }

            const oneLine = await postScene(place, sceneBody({ anchor_geometry: anchorPair({ startPage: 1, startLine: 7, endLine: 7 }) }));
            assert.equal(oneLine.status, 201, oneLine.text);
        });

        // changes in 11: every scene needs a valid version-2 anchor pair (A2)
        test("stores legacy pixel geometry unchanged", async () => {
            const legacy = [{ page: 1, x: 72, y: 140, width: 400, height: 14 }];
            assert.deepEqual((await saveInNewPlace(sceneBody({ anchor_geometry: legacy }))).anchor_geometry, legacy);
        });
    });

    test("reports the first invalid field in a fixed order", async () => {
        const place = await newPlace();
        await expectFieldOrder((body) => postScene(place, body));
    });
});

describe("overlapping film timing", () => {
    async function expectConflict(responsePromise, scene) {
        const response = await responsePromise;
        assert.equal(response.status, 409, response.text);
        assert.deepEqual(response.body, {
            error: MESSAGES.filmTimingOverlap,
            conflict_kind: "film_timing",
            conflict_scene_id: scene.id,
            conflict_start_time_seconds: scene.start_time_seconds,
            conflict_end_time_seconds: scene.end_time_seconds,
        });
    }

    test("a new scene that overlaps or contains another is a 409 naming it, and nothing is stored", async () => {
        const place = await newPlace();
        const existing = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });

        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 100, end_time_seconds: 150 })), existing);
        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 30, end_time_seconds: 70 })), existing);
        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 0, end_time_seconds: 200 })), existing);
        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 70, end_time_seconds: 80 })), existing);

        const list = await api.get(scenesPath(place));
        assert.deepEqual(list.body.map((scene) => scene.id), [existing.id]);
    });

    test("names the earliest-starting scene when several overlap", async () => {
        const place = await newPlace();
        const later = await createScene(api, cookie, place, { start_time_seconds: 200, end_time_seconds: 260 });
        const earlier = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        assert.ok(later.id);

        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 100, end_time_seconds: 210 })), earlier);
    });

    test("scenes that only touch save, in either order", async () => {
        const place = await newPlace();
        await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });

        const after = await postScene(place, sceneBody({ start_time_seconds: 120, end_time_seconds: 180 }));
        assert.equal(after.status, 201, after.text);
        const before = await postScene(place, sceneBody({ start_time_seconds: 0, end_time_seconds: 60 }));
        assert.equal(before.status, 201, before.text);
    });

    test("a zero-length timing overlaps only a scene that strictly contains it", async () => {
        const place = await newPlace();
        const existing = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });

        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 90, end_time_seconds: 90 })), existing);
        for (const moment of [60, 120]) {
            const atEdge = await postScene(place, sceneBody({ start_time_seconds: moment, end_time_seconds: moment }));
            assert.equal(atEdge.status, 201, atEdge.text);
        }

        const other = await newPlace();
        const moment = await createScene(api, cookie, other, { start_time_seconds: 10, end_time_seconds: 10 });
        await expectConflict(postScene(other, sceneBody({ start_time_seconds: 5, end_time_seconds: 15 })), moment);
        for (const [start, end] of [[10, 10], [0, 10], [10, 20]]) {
            const touching = await postScene(other, sceneBody({ start_time_seconds: start, end_time_seconds: end }));
            assert.equal(touching.status, 201, touching.text);
        }
    });

    test("a scene in another movie's script never conflicts", async () => {
        const place = await newPlace();
        await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        const other = await postScene(await newPlace(), sceneBody({ start_time_seconds: 60, end_time_seconds: 120 }));
        assert.equal(other.status, 201, other.text);
    });

    test("an update that overlaps another scene is a 409 naming it, and nothing is stored", async () => {
        const place = await newPlace();
        const first = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        const second = await createScene(api, cookie, place, { start_time_seconds: 200, end_time_seconds: 260 });

        await expectConflict(putScene(place, second.id, sceneBody({ start_time_seconds: 100, end_time_seconds: 150 })), first);
        await expectConflict(putScene(place, second.id, sceneBody({ start_time_seconds: 90, end_time_seconds: 260 })), first);

        const list = await api.get(scenesPath(place));
        assert.deepEqual(
            list.body.map((scene) => [scene.start_time_seconds, scene.end_time_seconds]),
            [
                [60, 120],
                [200, 260],
            ]
        );
    });

    test("an update that only touches other scenes saves, on either side", async () => {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place, { start_time_seconds: 200, end_time_seconds: 260 });
        await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        await createScene(api, cookie, place, { start_time_seconds: 300, end_time_seconds: 360 });

        const response = await putScene(place, scene.id, sceneBody({ start_time_seconds: 120, end_time_seconds: 300 }));
        assert.equal(response.status, 200, response.text);
    });

    test("an update never conflicts with the scene's own saved timing", async () => {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });

        const same = await putScene(place, scene.id, sceneBody({ start_time_seconds: 60, end_time_seconds: 120 }));
        assert.equal(same.status, 200, same.text);
        const wider = await putScene(place, scene.id, sceneBody({ start_time_seconds: 50, end_time_seconds: 130 }));
        assert.equal(wider.status, 200, wider.text);
    });
});

describe("overlapping script locations", () => {
    async function expectConflict(responsePromise, scene) {
        const response = await responsePromise;
        assert.equal(response.status, 409, response.text);
        assert.deepEqual(response.body, {
            error: MESSAGES.scriptLocationOverlap,
            conflict_kind: "script_location",
            conflict_scene_id: scene.id,
            conflict_start_time_seconds: scene.start_time_seconds,
            conflict_end_time_seconds: scene.end_time_seconds,
        });
    }

    // Each body gets its own film timing, so only script locations can conflict.
    let nextMinute = 0;
    function withGeometry(anchorGeometry) {
        const start = nextMinute * 60;
        nextMinute += 1;
        return sceneBody({ start_time_seconds: start, end_time_seconds: start + 30, anchor_geometry: anchorGeometry });
    }

    function atLines(range) {
        return withGeometry(anchorPair(range));
    }

    const PAGE_TWO = { startPage: 2, startLine: 10, endPage: 2, endLine: 20 };

    test("a scene sharing a line with another is a 409 naming it, and nothing is stored", async () => {
        const place = await newPlace();
        const existing = await createScene(api, cookie, place, atLines(PAGE_TWO));
        const sharing = [
            { startPage: 2, startLine: 20, endPage: 2, endLine: 30 }, // its last line
            { startPage: 2, startLine: 0, endPage: 2, endLine: 10 }, // its first line
            { startPage: 2, startLine: 10, endPage: 2, endLine: 10 }, // only its first line
            { startPage: 2, startLine: 12, endPage: 2, endLine: 15 }, // inside it
            { startPage: 1, startLine: 40, endPage: 3, endLine: 2 }, // containing it, across pages
            { startPage: 1, startLine: 30, endPage: 2, endLine: 10 }, // from an earlier page onto its first line
            { startPage: 2, startLine: 15, endPage: 4, endLine: 0 }, // from inside it onto a later page
        ];
        for (const range of sharing) {
            await expectConflict(postScene(place, atLines(range)), existing);
        }

        const list = await api.get(scenesPath(place));
        assert.deepEqual(list.body.map((scene) => scene.id), [existing.id]);
    });

    test("scenes on adjacent lines save, including across a page break", async () => {
        const place = await newPlace();
        await createScene(api, cookie, place, atLines(PAGE_TWO));
        const adjacent = [
            { startPage: 2, startLine: 21, endPage: 2, endLine: 30 },
            { startPage: 1, startLine: 50, endPage: 2, endLine: 9 },
            { startPage: 3, startLine: 0, endPage: 3, endLine: 5 },
        ];
        for (const range of adjacent) {
            const response = await postScene(place, atLines(range));
            assert.equal(response.status, 201, response.text);
        }
    });

    test("film timing is checked first", async () => {
        const place = await newPlace();
        const sameTiming = await createScene(api, cookie, place, atLines({ startPage: 1, startLine: 0, endLine: 4 }));
        await createScene(api, cookie, place, atLines({ startPage: 5, startLine: 0, endLine: 4 }));

        const response = await postScene(
            place,
            sceneBody({
                start_time_seconds: sameTiming.start_time_seconds,
                end_time_seconds: sameTiming.end_time_seconds,
                anchor_geometry: anchorPair({ startPage: 5, startLine: 2, endLine: 8 }),
            })
        );
        assert.equal(response.status, 409, response.text);
        assert.equal(response.body.conflict_kind, "film_timing");
        assert.equal(response.body.conflict_scene_id, sameTiming.id);
    });

    // changes in 11: every scene needs a valid version-2 anchor pair (A2)
    test("scenes without a valid version-2 anchor pair are skipped, on either side", async () => {
        const [start, end] = anchorPair(PAGE_TWO);
        const legacy = [{ page: 2, x: 72, y: 140, width: 400, height: 14 }];

        const place = await newPlace();
        await createScene(api, cookie, place, atLines(PAGE_TWO));
        for (const geometry of [legacy, [start], [end], []]) {
            const response = await postScene(place, withGeometry(geometry));
            assert.equal(response.status, 201, response.text);
        }

        const legacyPlace = await newPlace();
        for (const geometry of [legacy, [start], [end]]) {
            await createScene(api, cookie, legacyPlace, withGeometry(geometry));
        }
        const anchored = await postScene(legacyPlace, atLines(PAGE_TWO));
        assert.equal(anchored.status, 201, anchored.text);
    });

    test("a start anchor after its end anchor is a 400 on write, and a stored one is skipped", async () => {
        const place = await newPlace();
        const reversedRange = { startPage: 3, startLine: 0, endPage: 2, endLine: 10 };
        await expectError(postScene(place, atLines(reversedRange)), 400, MESSAGES.reversedPair);

        // changes in 11: every scene needs a valid version-2 anchor pair (A2)
        const stored = await createScene(api, cookie, place, atLines(PAGE_TWO));
        await pool.query("UPDATE script_scene_anchors SET anchor_geometry = $1::jsonb WHERE id = $2", [
            JSON.stringify(anchorPair(reversedRange)),
            stored.anchor_id,
        ]);
        // One range shares the stored end anchor's line; the other lies between its anchors.
        for (const range of [PAGE_TWO, { startPage: 2, startLine: 30, endPage: 2, endLine: 31 }]) {
            const response = await postScene(place, atLines(range));
            assert.equal(response.status, 201, response.text);
        }
    });

    test("an update never conflicts with the scene's own saved lines", async () => {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place, atLines(PAGE_TWO));

        const same = await putScene(
            place,
            scene.id,
            sceneBody({
                start_time_seconds: scene.start_time_seconds,
                end_time_seconds: scene.end_time_seconds,
                anchor_geometry: scene.anchor_geometry,
            })
        );
        assert.equal(same.status, 200, same.text);
        const moved = await putScene(place, scene.id, atLines({ startPage: 2, startLine: 15, endPage: 2, endLine: 25 }));
        assert.equal(moved.status, 200, moved.text);
    });

    test("an update onto another scene's lines is a 409, and nothing is stored", async () => {
        const place = await newPlace();
        const first = await createScene(api, cookie, place, atLines(PAGE_TWO));
        const second = await createScene(api, cookie, place, atLines({ startPage: 3, startLine: 0, endPage: 3, endLine: 10 }));

        await expectConflict(putScene(place, second.id, atLines({ startPage: 2, startLine: 20, endPage: 3, endLine: 10 })), first);

        const list = await api.get(scenesPath(place));
        assert.deepEqual(list.body.find((scene) => scene.id === second.id), second);
    });

    test("a scene on the same lines in another script never conflicts", async () => {
        await createScene(api, cookie, await newPlace(), atLines(PAGE_TWO));
        const other = await postScene(await newPlace(), atLines(PAGE_TWO));
        assert.equal(other.status, 201, other.text);
    });
});

describe("updating a captured scene", () => {
    async function savedScene(overrides) {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place, overrides);
        return { place, scene };
    }

    test("returns 200 with the whole scene after replacing every field it is sent", async () => {
        const { place, scene } = await savedScene();
        const body = sceneBody({
            start_time_seconds: 300,
            end_time_seconds: 360,
            selected_text: "## EXT. PARKING LOT - NIGHT",
            raw_selected_text: "EXT. PARKING LOT - NIGHT",
            formatted_selected_text: "## EXT. PARKING LOT - NIGHT",
            page_start: 2,
            page_end: 3,
            start_offset: 400,
            end_offset: 800,
            context_prefix: "Before.",
            context_suffix: "After.",
            anchor_geometry: anchorPair({ startPage: 2, startLine: 3, endPage: 3, endLine: 1 }),
            tags: [TAGS.revelation, TAGS.selfConflict],
        });

        const response = await putScene(place, scene.id, body);
        assert.equal(response.status, 200, response.text);
        const updated = response.body;
        assert.deepEqual(Object.keys(updated).sort(), SCENE_FIELDS);
        assert.equal(updated.id, scene.id);
        // changes in 11: anchor_id is removed (B4)
        assert.equal(updated.anchor_id, scene.anchor_id);
        assert.equal(updated.created_at, scene.created_at);
        assert.ok(Date.parse(updated.updated_at) >= Date.parse(scene.updated_at));
        assert.equal(updated.start_time_seconds, 300);
        assert.equal(updated.end_time_seconds, 360);
        assert.deepEqual(updated.tags, body.tags);
        for (const field of LOCATION_FIELDS) assert.deepEqual(updated[field], body[field], field);
    });

    test("answers 404 for a missing scene or one in another script, but only after the body is valid", async () => {
        const { place, scene } = await savedScene();
        const other = await newPlace();

        await expectError(putScene(place, randomUUID(), sceneBody()), 404, MESSAGES.sceneNotFound);
        await expectError(putScene(other, scene.id, sceneBody()), 404, MESSAGES.sceneNotFound);
        await expectError(putScene(place, randomUUID(), { start_time_seconds: "abc" }), 400, MESSAGES.filmTiming);
    });

    test("requires the sign-in cookie", async () => {
        const { place, scene } = await savedScene();
        await expectError(api.put(`${scenesPath(place)}/${scene.id}`, { body: sceneBody() }), 401, "Sign in to make changes.");
    });

    describe("replaces the whole scene", () => {
        test("a partial body, an empty body or no body at all is a 400, and the saved scene is unchanged", async () => {
            const { place, scene } = await savedScene();
            await expectError(putScene(place, scene.id, { tags: [TAGS.revelation] }), 400, MESSAGES.filmTiming);
            await expectError(putScene(place, scene.id, { start_time_seconds: 60, end_time_seconds: 90 }), 400, MESSAGES.rawText);
            await expectError(putScene(place, scene.id, {}), 400, MESSAGES.filmTiming);
            await expectError(api.put(`${scenesPath(place)}/${scene.id}`, { cookie }), 400, MESSAGES.filmTiming);

            assert.deepEqual((await api.get(scenesPath(place))).body, [scene]);
        });

        // changes in 11: offsets, context, the text fields and empty geometry change (A2, A4, A6)
        test("fields left out are cleared, as they are on create", async () => {
            const { place, scene } = await savedScene();
            const cleared = ["page_start", "page_end", "start_offset", "end_offset", "context_prefix", "context_suffix", "formatted_selected_text"];
            const response = await putScene(place, scene.id, without(sceneBody(), ...cleared, "tags", "anchor_geometry"));

            assert.equal(response.status, 200, response.text);
            for (const field of cleared) assert.equal(response.body[field], null, field);
            assert.deepEqual(response.body.tags, []);
            assert.deepEqual(response.body.anchor_geometry, []);
        });

        // changes in 11: selected_text is removed (A4)
        test("selected text follows the body's text, not the saved scene's", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(
                place,
                scene.id,
                without(sceneBody({ formatted_selected_text: "New formatted", raw_selected_text: "New raw" }), "selected_text")
            );
            assert.equal(response.status, 200, response.text);
            assert.notEqual(scene.selected_text, "New formatted");
            assert.equal(response.body.selected_text, "New formatted");
            assert.equal(response.body.raw_selected_text, "New raw");
        });
    });

    describe("validation", () => {
        test("follows the create rules, with the same messages, and stores nothing", async () => {
            const { place, scene } = await savedScene();
            const [start, end] = anchorPair();
            const invalid = [
                [{ start_time_seconds: "30" }, MESSAGES.filmTiming],
                [{ end_time_seconds: null }, MESSAGES.filmTiming],
                [{ start_time_seconds: 50, end_time_seconds: 40 }, MESSAGES.filmTiming],
                [{ page_end: "2" }, MESSAGES.pages],
                [{ page_start: 3, page_end: 2 }, MESSAGES.pages],
                // changes in 11: context and offsets are removed (A6)
                [{ context_prefix: 5 }, MESSAGES.context],
                [{ start_offset: "" }, MESSAGES.offsets],
                // changes in 11: one scene text field and one raw text field (A4)
                [{ raw_selected_text: " ", selected_text: null }, MESSAGES.rawText],
                [{ tags: `${TAGS.revelation},${TAGS.protagonist}` }, MESSAGES.tags],
                [{ tags: "" }, MESSAGES.tags],
                [{ anchor_geometry: JSON.stringify(anchorPair()) }, MESSAGES.geometry],
                [{ anchor_geometry: "" }, MESSAGES.geometry],
                [{ anchor_geometry: [{ ...start, unit: "px" }, end] }, MESSAGES.sceneAnchor],
                [{ anchor_geometry: [{ ...end, kind: "start" }, { ...start, kind: "end" }] }, MESSAGES.reversedPair],
            ];
            for (const [fields, message] of invalid) {
                await expectError(putScene(place, scene.id, sceneBody(fields)), 400, message);
            }

            assert.deepEqual((await api.get(scenesPath(place))).body, [scene]);
        });

        test("reports the first invalid field in the same order as a create", async () => {
            const { place, scene } = await savedScene();
            await expectFieldOrder((body) => putScene(place, scene.id, body));
        });
    });

    describe("null and empty values", () => {
        // changes in 11: the text fields are replaced (A4)
        test("null formatted text is stored as null, and null or blank selected text falls back to formatted, then raw", async () => {
            const { place, scene } = await savedScene();

            const nulledFormatted = await putScene(place, scene.id, sceneBody({ formatted_selected_text: null }));
            assert.equal(nulledFormatted.status, 200, nulledFormatted.text);
            assert.equal(nulledFormatted.body.formatted_selected_text, null);
            assert.equal(nulledFormatted.body.selected_text, scene.selected_text);

            const toRaw = await putScene(place, scene.id, sceneBody({ selected_text: null, formatted_selected_text: null }));
            assert.equal(toRaw.body.selected_text, scene.raw_selected_text);

            const toFormatted = await putScene(place, scene.id, sceneBody({ selected_text: " ", formatted_selected_text: "Formatted" }));
            assert.equal(toFormatted.body.selected_text, "Formatted");
        });

        // changes in 11: context is removed (A6)
        test("null context clears it", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, sceneBody({ context_prefix: null, context_suffix: null }));
            assert.equal(response.status, 200, response.text);
            assert.equal(response.body.context_prefix, null);
            assert.equal(response.body.context_suffix, null);
        });

        // changes in 11: every scene needs a valid version-2 anchor pair, so null geometry is invalid (A2)
        test("null tags and null geometry become empty lists", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, sceneBody({ tags: null, anchor_geometry: null }));
            assert.equal(response.status, 200, response.text);
            assert.deepEqual(response.body.tags, []);
            assert.deepEqual(response.body.anchor_geometry, []);
        });

        // changes in 11: the text fields are replaced and context is removed (A4, A6)
        test("an empty string is stored as formatted text and as context", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, sceneBody({ formatted_selected_text: "", context_prefix: "" }));
            assert.equal(response.status, 200, response.text);
            assert.equal(response.body.formatted_selected_text, "");
            assert.equal(response.body.selected_text, scene.selected_text);
            assert.equal(response.body.context_prefix, "");
        });
    });
});

describe("deleting a captured scene", () => {
    test("returns 204, removes the scene and its anchor row, and frees its film timing", async () => {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place);

        const response = await api.delete(`${scenesPath(place)}/${scene.id}`, { cookie });
        assert.equal(response.status, 204);
        assert.equal(response.text, "");

        const list = await api.get(scenesPath(place));
        assert.deepEqual(list.body, []);
        // changes in 11: anchors are stored on the scene row (A5)
        const anchors = await pool.query("SELECT id FROM script_scene_anchors WHERE id = $1", [scene.anchor_id]);
        assert.equal(anchors.rowCount, 0);

        const again = await postScene(place, sceneBody());
        assert.equal(again.status, 201, again.text);
    });

    test("answers 404 for a missing scene, one already deleted, or one in another script", async () => {
        const place = await newPlace();
        const other = await newPlace();
        const scene = await createScene(api, cookie, place);

        await expectError(api.delete(`${scenesPath(other)}/${scene.id}`, { cookie }), 404, MESSAGES.sceneNotFound);
        await expectError(api.delete(`${scenesPath(place)}/${randomUUID()}`, { cookie }), 404, MESSAGES.sceneNotFound);
        assert.equal((await api.delete(`${scenesPath(place)}/${scene.id}`, { cookie })).status, 204);
        await expectError(api.delete(`${scenesPath(place)}/${scene.id}`, { cookie }), 404, MESSAGES.sceneNotFound);
    });

    test("requires the sign-in cookie", async () => {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place);
        await expectError(api.delete(`${scenesPath(place)}/${scene.id}`), 401, "Sign in to make changes.");
    });

    test("waits for the script's lock, which saves hold until they commit, then answers 204", async () => {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place);
        const holder = await pool.connect();
        try {
            await holder.query("BEGIN");
            // An uppercase spelling of the id names the same script, so it takes the same lock.
            await holder.query(LOCK_SCRIPT_SCENES_SQL, [place.script.id.toUpperCase()]);
            const deleting = api.delete(`${scenesPath(place)}/${scene.id}`, { cookie });
            await waitForLockWaiters(1, "advisory");
            await holder.query("COMMIT");

            const response = await deleting;
            assert.equal(response.status, 204, response.text);
            assert.deepEqual((await api.get(scenesPath(place))).body, []);
        } catch (err) {
            await holder.query("ROLLBACK");
            throw err;
        } finally {
            holder.release();
        }
    });

    test("a scene id that isn't a UUID is a 500, on update and delete", async (t) => {
        t.mock.method(console, "error", () => {});
        const place = await newPlace();
        await expectError(putScene(place, "not-a-uuid", sceneBody()), 500, "Something went wrong on the server.");
        await expectError(api.delete(`${scenesPath(place)}/not-a-uuid`, { cookie }), 500, "Something went wrong on the server.");
    });
});

describe("concurrent saves to one script", () => {
    /**
     * Sends the saves at once while another transaction blocks inserts into
     * script_scene_anchors, and releases that block only once both saves are
     * waiting on a lock. Without the script's advisory lock, both saves pass the
     * overlap check before either has written, and both are stored.
     */
    async function createAtOnce(requests) {
        const blocker = await pool.connect();
        try {
            await blocker.query("BEGIN");
            await blocker.query("LOCK TABLE script_scene_anchors IN EXCLUSIVE MODE");
            const responses = requests.map(({ place, body }) => postScene(place, body));
            await waitForLockWaiters(requests.length);
            await blocker.query("COMMIT");
            return await Promise.all(responses);
        } catch (err) {
            await blocker.query("ROLLBACK");
            throw err;
        } finally {
            blocker.release();
        }
    }

    async function expectOneStored(place, responses, conflictKind) {
        assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
        const stored = responses.find((response) => response.status === 201).body;
        const refused = responses.find((response) => response.status === 409).body;
        assert.equal(refused.conflict_kind, conflictKind);
        assert.equal(refused.conflict_scene_id, stored.id);
        assert.deepEqual((await api.get(scenesPath(place))).body.map((scene) => scene.id), [stored.id]);
    }

    test("of two scenes whose film timings overlap, exactly one is stored, however the script id is spelled", async () => {
        const place = await newPlace();
        // Postgres reads the uppercase id as the same script, so both saves must take the same lock.
        const uppercase = { movie: place.movie, script: { id: place.script.id.toUpperCase() } };
        const responses = await createAtOnce([
            { place, body: sceneBody({ start_time_seconds: 60, end_time_seconds: 120 }) },
            { place: uppercase, body: sceneBody({ start_time_seconds: 100, end_time_seconds: 160 }) },
        ]);
        await expectOneStored(place, responses, "film_timing");
    });

    test("of two scenes whose script locations share a line, exactly one is stored", async () => {
        const place = await newPlace();
        const responses = await createAtOnce([
            {
                place,
                body: sceneBody({ start_time_seconds: 0, end_time_seconds: 50, anchor_geometry: anchorPair({ startPage: 2, startLine: 10, endLine: 20 }) }),
            },
            {
                place,
                body: sceneBody({ start_time_seconds: 100, end_time_seconds: 150, anchor_geometry: anchorPair({ startPage: 2, startLine: 20, endLine: 30 }) }),
            },
        ]);
        await expectOneStored(place, responses, "script_location");
    });
});
