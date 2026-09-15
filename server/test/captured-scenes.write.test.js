import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
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
    sceneNotFound: "Script scene annotation not found",
    scriptNotFound: "Script not found",
    // changes in 04: the message follows the new rule, and a conflict_kind detail is added
    overlap: "Scene time range overlaps an existing scene in this script.",
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
    function conflict(scene) {
        return {
            error: MESSAGES.overlap,
            conflict_scene_id: scene.id,
            conflict_start_time_seconds: scene.start_time_seconds,
            conflict_end_time_seconds: scene.end_time_seconds,
        };
    }

    async function expectConflict(responsePromise, scene) {
        const response = await responsePromise;
        assert.equal(response.status, 409, response.text);
        assert.deepEqual(response.body, conflict(scene));
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

    // changes in 04: scenes that only touch are allowed
    test("scenes that only touch conflict, on either side", async () => {
        const place = await newPlace();
        const existing = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });

        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 120, end_time_seconds: 180 })), existing);
        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 0, end_time_seconds: 60 })), existing);
    });

    test("a zero-length timing conflicts with a scene that contains it, including at its edges", async () => {
        const place = await newPlace();
        const existing = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });

        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 90, end_time_seconds: 90 })), existing);
        // changes in 04: a zero-length timing at another scene's edge is allowed
        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 120, end_time_seconds: 120 })), existing);

        const elsewhere = await postScene(place, sceneBody({ start_time_seconds: 10, end_time_seconds: 10 }));
        assert.equal(elsewhere.status, 201, elsewhere.text);
        // changes in 04: two zero-length timings at the same moment don't overlap
        await expectConflict(postScene(place, sceneBody({ start_time_seconds: 10, end_time_seconds: 10 })), elsewhere.body);
    });

    test("a scene in another movie's script never conflicts", async () => {
        const place = await newPlace();
        await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        const other = await postScene(await newPlace(), sceneBody({ start_time_seconds: 60, end_time_seconds: 120 }));
        assert.equal(other.status, 201, other.text);
    });

    // changes in 04: scenes whose script locations share a line are a 409
    test("script locations aren't compared: scenes on the same lines save when their timing doesn't overlap", async () => {
        const place = await newPlace();
        await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120, anchor_geometry: anchorPair() });
        const sameLines = await postScene(
            place,
            sceneBody({ start_time_seconds: 200, end_time_seconds: 260, anchor_geometry: anchorPair() })
        );
        assert.equal(sameLines.status, 201, sameLines.text);
    });

    test("an update that overlaps another scene is a 409 naming it, and nothing is stored", async () => {
        const place = await newPlace();
        const first = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });
        const second = await createScene(api, cookie, place, { start_time_seconds: 200, end_time_seconds: 260 });

        await expectConflict(putScene(place, second.id, sceneBody({ start_time_seconds: 100, end_time_seconds: 150 })), first);
        // changes in 04: touching is allowed
        await expectConflict(putScene(place, second.id, sceneBody({ start_time_seconds: 120, end_time_seconds: 180 })), first);
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

    test("an update never conflicts with the scene's own saved timing", async () => {
        const place = await newPlace();
        const scene = await createScene(api, cookie, place, { start_time_seconds: 60, end_time_seconds: 120 });

        const same = await putScene(place, scene.id, sceneBody({ start_time_seconds: 60, end_time_seconds: 120 }));
        assert.equal(same.status, 200, same.text);
        const wider = await putScene(place, scene.id, sceneBody({ start_time_seconds: 50, end_time_seconds: 130 }));
        assert.equal(wider.status, 200, wider.text);
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

    test("a scene id that isn't a UUID is a 500, on update and delete", async (t) => {
        t.mock.method(console, "error", () => {});
        const place = await newPlace();
        await expectError(putScene(place, "not-a-uuid", sceneBody()), 500, "Something went wrong on the server.");
        await expectError(api.delete(`${scenesPath(place)}/not-a-uuid`, { cookie }), 500, "Something went wrong on the server.");
    });
});
