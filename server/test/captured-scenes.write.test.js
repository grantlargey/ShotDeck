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
    createTiming:
        "Invalid body. start_time_seconds and end_time_seconds must be integers where end >= start and start >= 0.",
    createPages: "Invalid body. page_start/page_end must be positive integers and page_end >= page_start.",
    createContext: "Invalid body. context_prefix/context_suffix must be strings when provided.",
    createOffsets: "Invalid body. start_offset/end_offset must be integers where end_offset >= start_offset >= 0.",
    createRaw: "Invalid body. raw_selected_text must be a non-empty string.",
    tags: "Invalid body. tags must be an array of strings or comma-separated string.",
    geometry: "Invalid body. anchor_geometry must be a JSON array when provided.",
    updateTimingType: "start_time_seconds/end_time_seconds must be integers when provided.",
    updateTimingRange: "Invalid time range. end_time_seconds must be >= start_time_seconds >= 0.",
    updatePagesType: "page_start/page_end must be integers when provided.",
    updatePagesRange: "Invalid page range. page_start/page_end must be positive and page_end >= page_start.",
    updateOffsetsType: "start_offset/end_offset must be integers when provided.",
    updateOffsetsRange: "Invalid offsets. start_offset/end_offset must be >= 0 and end_offset >= start_offset.",
    updateTextTypes: "Invalid body. Text fields must be strings when provided (or null where supported).",
    updateRaw: "raw_selected_text must remain a non-empty string.",
    sceneNotFound: "Script scene annotation not found",
    scriptNotFound: "Script not found",
    // changes in 04: the message follows the new rule, and a conflict_kind detail is added
    overlap: "Scene time range overlaps an existing scene in this script.",
};

// changes in 04: no nested `anchor` (B4); changes in 11: anchor_id, the text fields, offsets and context
const SCENE_FIELDS = [
    "anchor",
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

function withoutUpdatedAt(scene) {
    const { updated_at: _updatedAt, anchor, ...rest } = scene;
    const { updated_at: _anchorUpdatedAt, ...anchorRest } = anchor;
    return { ...rest, anchor: anchorRest };
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

/** Creates a scene from `body` in a fresh script and returns the saved scene. */
async function saveInNewPlace(body) {
    const response = await postScene(await newPlace(), body);
    assert.equal(response.status, 201, response.text);
    return response.body;
}

describe("creating a captured scene", () => {
    test("returns 201 with the scene, its script location flat and again under `anchor`", async () => {
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

        // changes in 04: the nested anchor object is removed (B4)
        assert.deepEqual(scene.anchor, {
            id: scene.anchor_id,
            ...Object.fromEntries(LOCATION_FIELDS.map((field) => [field, body[field]])),
            created_at: scene.anchor.created_at,
            updated_at: scene.anchor.updated_at,
        });
        assert.ok(!Number.isNaN(Date.parse(scene.anchor.created_at)));
    });

    test("requires the sign-in cookie", async () => {
        const place = await newPlace();
        await expectError(api.post(scenesPath(place), { body: sceneBody() }), 401, "Sign in to make changes.");
    });

    test("answers 404 when the script isn't the movie's, but only after the body is valid", async () => {
        const place = await newPlace();
        const other = await newPlace();
        const wrongScript = { movie: place.movie, script: other.script };
        const missingScript = { movie: place.movie, script: { id: randomUUID() } };

        await expectError(postScene(wrongScript, sceneBody()), 404, MESSAGES.scriptNotFound);
        await expectError(postScene(missingScript, sceneBody()), 404, MESSAGES.scriptNotFound);
        await expectError(postScene(missingScript, without(sceneBody(), "start_time_seconds")), 400, MESSAGES.createTiming);
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
                await expectError(postScene(place, body), 400, MESSAGES.createTiming);
            }
        });

        // changes in 04: values are no longer coerced to numbers (B9)
        test("coerces numeric strings, and null or an empty string counts as 0", async () => {
            const fromStrings = await saveInNewPlace(sceneBody({ start_time_seconds: "15", end_time_seconds: "30" }));
            assert.equal(fromStrings.start_time_seconds, 15);
            assert.equal(fromStrings.end_time_seconds, 30);

            const fromNull = await saveInNewPlace(sceneBody({ start_time_seconds: null, end_time_seconds: 5 }));
            assert.equal(fromNull.start_time_seconds, 0);

            const fromEmpty = await saveInNewPlace(sceneBody({ start_time_seconds: "", end_time_seconds: "" }));
            assert.equal(fromEmpty.start_time_seconds, 0);
            assert.equal(fromEmpty.end_time_seconds, 0);
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
                await expectError(postScene(place, body), 400, MESSAGES.createPages);
            }
        });

        test("are stored as null when missing, null or empty strings", async () => {
            const missing = await saveInNewPlace(without(sceneBody(), "page_start", "page_end"));
            assert.equal(missing.page_start, null);
            assert.equal(missing.page_end, null);

            const nulls = await saveInNewPlace(sceneBody({ page_start: null, page_end: 4 }));
            assert.equal(nulls.page_start, null);
            assert.equal(nulls.page_end, 4);

            // changes in 04: empty strings are rejected (B9)
            const empty = await saveInNewPlace(sceneBody({ page_start: "", page_end: "" }));
            assert.equal(empty.page_start, null);
            assert.equal(empty.page_end, null);
        });

        // changes in 04: values are no longer coerced to numbers (B9)
        test("coerce numeric strings", async () => {
            const scene = await saveInNewPlace(sceneBody({ page_start: "2", page_end: "3" }));
            assert.equal(scene.page_start, 2);
            assert.equal(scene.page_end, 3);
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
                await expectError(postScene(place, body), 400, MESSAGES.createOffsets);
            }
        });

        // changes in 04: numeric and empty strings are rejected (B9)
        test("offsets are null when missing, null or empty, and numeric strings are coerced", async () => {
            const missing = await saveInNewPlace(without(sceneBody(), "start_offset", "end_offset"));
            assert.equal(missing.start_offset, null);
            assert.equal(missing.end_offset, null);

            const mixed = await saveInNewPlace(sceneBody({ start_offset: null, end_offset: "" }));
            assert.equal(mixed.start_offset, null);
            assert.equal(mixed.end_offset, null);

            const strings = await saveInNewPlace(sceneBody({ start_offset: "5", end_offset: "9" }));
            assert.equal(strings.start_offset, 5);
            assert.equal(strings.end_offset, 9);
        });

        test("context must be a string or null", async () => {
            const place = await newPlace();
            for (const body of [sceneBody({ context_prefix: 5 }), sceneBody({ context_suffix: {} })]) {
                await expectError(postScene(place, body), 400, MESSAGES.createContext);
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
                await expectError(postScene(place, body), 400, MESSAGES.createRaw);
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

        // changes in 11: only taxonomy tags are accepted (A9); changes in 04: non-string tags are rejected (B9)
        test("accept values outside the tag taxonomy, and turn numbers into strings", async () => {
            const scene = await saveInNewPlace(sceneBody({ tags: ["Diner", 7] }));
            assert.deepEqual(scene.tags, ["Diner", "7"]);
        });

        // changes in 04: string tags are rejected (B9)
        test("accept a comma- or newline-separated string", async () => {
            const scene = await saveInNewPlace(sceneBody({ tags: `${TAGS.protagonist}, ${TAGS.revelation}\n${TAGS.selfConflict}` }));
            assert.deepEqual(scene.tags, [TAGS.protagonist, TAGS.revelation, TAGS.selfConflict]);
        });

        test("that are neither a list nor a string are a 400", async () => {
            const place = await newPlace();
            for (const tags of [5, { tag: TAGS.protagonist }, true]) {
                await expectError(postScene(place, sceneBody({ tags })), 400, MESSAGES.tags);
            }
        });
    });

    describe("anchor geometry", () => {
        test("is an empty list when missing or null", async () => {
            assert.deepEqual((await saveInNewPlace(without(sceneBody(), "anchor_geometry"))).anchor_geometry, []);
            assert.deepEqual((await saveInNewPlace(sceneBody({ anchor_geometry: null }))).anchor_geometry, []);
        });

        // changes in 04: stringified geometry is rejected (B9)
        test("accepts a JSON string holding a list, and treats a blank string as an empty list", async () => {
            const parsed = await saveInNewPlace(sceneBody({ anchor_geometry: JSON.stringify(anchorPair()) }));
            assert.deepEqual(parsed.anchor_geometry, anchorPair());
            assert.deepEqual((await saveInNewPlace(sceneBody({ anchor_geometry: "  " }))).anchor_geometry, []);
        });

        test("that isn't a list, or a string holding one, is a 400", async () => {
            const place = await newPlace();
            for (const anchorGeometry of ["not json", '{"page":1}', { page: 1 }, 5]) {
                await expectError(postScene(place, sceneBody({ anchor_geometry: anchorGeometry })), 400, MESSAGES.geometry);
            }
        });

        // changes in 04: version-2 entries are validated strictly
        test("stores malformed version-2 entries unchanged", async () => {
            const malformed = [{ kind: "middle", version: 2, unit: "px", page: 0, line: -1, top: "a", bottom: null }];
            assert.deepEqual((await saveInNewPlace(sceneBody({ anchor_geometry: malformed }))).anchor_geometry, malformed);
        });

        // changes in 11: every scene needs a valid version-2 anchor pair (A2)
        test("stores legacy pixel geometry unchanged", async () => {
            const legacy = [{ page: 1, x: 72, y: 140, width: 400, height: 14 }];
            assert.deepEqual((await saveInNewPlace(sceneBody({ anchor_geometry: legacy }))).anchor_geometry, legacy);
        });
    });

    test("reports the first invalid field in a fixed order", async () => {
        const place = await newPlace();
        const everythingWrong = {
            start_time_seconds: -1,
            page_start: 0,
            context_prefix: 1,
            start_offset: -1,
            raw_selected_text: "",
            tags: 5,
            anchor_geometry: 5,
        };
        const order = [
            ["start_time_seconds", MESSAGES.createTiming],
            ["page_start", MESSAGES.createPages],
            ["context_prefix", MESSAGES.createContext],
            ["start_offset", MESSAGES.createOffsets],
            ["raw_selected_text", MESSAGES.createRaw],
            ["tags", MESSAGES.tags],
            ["anchor_geometry", MESSAGES.geometry],
        ];
        let body = sceneBody(everythingWrong);
        for (const [field, message] of order) {
            await expectError(postScene(place, body), 400, message);
            body = { ...body, [field]: sceneBody()[field] };
        }
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
        // changes in 04: a partial update is no longer accepted
        await expectConflict(putScene(place, second.id, { start_time_seconds: 90 }), first);

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
        assert.equal(updated.anchor_id, scene.anchor_id);
        assert.equal(updated.created_at, scene.created_at);
        assert.ok(Date.parse(updated.updated_at) >= Date.parse(scene.updated_at));
        assert.equal(updated.start_time_seconds, 300);
        assert.equal(updated.end_time_seconds, 360);
        assert.deepEqual(updated.tags, body.tags);
        for (const field of LOCATION_FIELDS) {
            assert.deepEqual(updated[field], body[field], field);
            assert.deepEqual(updated.anchor[field], body[field], `anchor.${field}`);
        }
        assert.equal(updated.anchor.created_at, scene.anchor.created_at);
    });

    test("answers 404 for a missing scene or one in another script, before validating the body", async () => {
        const { place, scene } = await savedScene();
        const other = await newPlace();

        await expectError(putScene(place, randomUUID(), sceneBody()), 404, MESSAGES.sceneNotFound);
        await expectError(putScene(other, scene.id, sceneBody()), 404, MESSAGES.sceneNotFound);
        await expectError(putScene(place, randomUUID(), { start_time_seconds: "abc" }), 404, MESSAGES.sceneNotFound);
    });

    test("requires the sign-in cookie", async () => {
        const { place, scene } = await savedScene();
        await expectError(api.put(`${scenesPath(place)}/${scene.id}`, { body: sceneBody() }), 401, "Sign in to make changes.");
    });

    // changes in 04: an update replaces the whole scene and requires the same fields as create
    describe("fields left out keep their saved values", () => {
        test("a body with only tags changes only the tags", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, { tags: [TAGS.revelation] });
            assert.equal(response.status, 200, response.text);
            assert.deepEqual(withoutUpdatedAt(response.body), withoutUpdatedAt({ ...scene, tags: [TAGS.revelation] }));
        });

        test("an empty body, or no body at all, changes nothing", async () => {
            const { place, scene } = await savedScene();
            const empty = await putScene(place, scene.id, {});
            assert.equal(empty.status, 200, empty.text);
            assert.deepEqual(withoutUpdatedAt(empty.body), withoutUpdatedAt(scene));

            const none = await api.put(`${scenesPath(place)}/${scene.id}`, { cookie });
            assert.equal(none.status, 200, none.text);
            assert.deepEqual(withoutUpdatedAt(none.body), withoutUpdatedAt(scene));
        });

        test("null or an empty string keeps the saved film timing", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, { start_time_seconds: null, end_time_seconds: "" });
            assert.equal(response.status, 200, response.text);
            assert.equal(response.body.start_time_seconds, 60);
            assert.equal(response.body.end_time_seconds, 120);
        });

        test("an empty string keeps saved pages and offsets, while null clears them", async () => {
            const { place, scene } = await savedScene();
            const kept = await putScene(place, scene.id, { page_start: "", page_end: "", start_offset: "", end_offset: "" });
            assert.equal(kept.status, 200, kept.text);
            assert.equal(kept.body.page_start, scene.page_start);
            assert.equal(kept.body.end_offset, scene.end_offset);

            const cleared = await putScene(place, scene.id, { page_start: null, page_end: null, start_offset: null, end_offset: null });
            assert.equal(cleared.status, 200, cleared.text);
            assert.equal(cleared.body.page_start, null);
            assert.equal(cleared.body.page_end, null);
            assert.equal(cleared.body.start_offset, null);
            assert.equal(cleared.body.end_offset, null);
        });

        test("new film timing is checked against the saved value it is paired with", async () => {
            const { place, scene } = await savedScene({ start_time_seconds: 60, end_time_seconds: 120 });
            await expectError(putScene(place, scene.id, { start_time_seconds: 150 }), 400, MESSAGES.updateTimingRange);

            const moved = await putScene(place, scene.id, { end_time_seconds: 90 });
            assert.equal(moved.status, 200, moved.text);
            assert.equal(moved.body.start_time_seconds, 60);
            assert.equal(moved.body.end_time_seconds, 90);
        });

        test("new pages are checked against the saved value they are paired with", async () => {
            const { place, scene } = await savedScene({ page_start: 1, page_end: 1 });
            await expectError(putScene(place, scene.id, { page_start: 5 }), 400, MESSAGES.updatePagesRange);
        });

        // changes in 11: selected_text is removed (A4)
        test("saved selected text is kept when only the formatted or raw text changes", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, {
                formatted_selected_text: "New formatted",
                raw_selected_text: "New raw",
            });
            assert.equal(response.status, 200, response.text);
            assert.equal(response.body.selected_text, scene.selected_text);
            assert.equal(response.body.formatted_selected_text, "New formatted");
            assert.equal(response.body.raw_selected_text, "New raw");
        });
    });

    // changes in 04: an update is validated like a create, with create's required fields and messages
    describe("validation", () => {
        test("film timing must be whole numbers, start >= 0 and end >= start", async () => {
            const { place, scene } = await savedScene();
            for (const body of [{ start_time_seconds: "abc" }, { end_time_seconds: 1.5 }, { start_time_seconds: {} }]) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updateTimingType);
            }
            for (const body of [{ start_time_seconds: -5 }, { start_time_seconds: 50, end_time_seconds: 40 }]) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updateTimingRange);
            }
        });

        // changes in 04: values are no longer coerced to numbers (B9)
        test("numeric strings are coerced", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, { start_time_seconds: "30", end_time_seconds: "45", page_end: "2" });
            assert.equal(response.status, 200, response.text);
            assert.equal(response.body.start_time_seconds, 30);
            assert.equal(response.body.end_time_seconds, 45);
            assert.equal(response.body.page_end, 2);
        });

        test("pages must be positive whole numbers with page_end >= page_start", async () => {
            const { place, scene } = await savedScene();
            for (const body of [{ page_start: "abc" }, { page_end: 2.5 }]) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updatePagesType);
            }
            for (const body of [{ page_start: 0 }, { page_start: 3, page_end: 2 }]) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updatePagesRange);
            }
        });

        // changes in 11: offsets are removed (A6)
        test("offsets must be whole numbers with end_offset >= start_offset >= 0", async () => {
            const { place, scene } = await savedScene();
            for (const body of [{ start_offset: "x" }, { end_offset: 0.5 }]) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updateOffsetsType);
            }
            for (const body of [{ start_offset: -1 }, { start_offset: 90, end_offset: 80 }]) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updateOffsetsRange);
            }
        });

        test("text and context fields must be strings or null", async () => {
            const { place, scene } = await savedScene();
            const invalid = [
                { selected_text: 5 },
                { raw_selected_text: 5 },
                { formatted_selected_text: [] },
                { context_prefix: 5 },
                { context_suffix: {} },
            ];
            for (const body of invalid) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updateTextTypes);
            }
        });

        test("raw text can't become null or blank", async () => {
            const { place, scene } = await savedScene();
            for (const body of [{ raw_selected_text: null }, { raw_selected_text: "" }, { raw_selected_text: "  " }]) {
                await expectError(putScene(place, scene.id, body), 400, MESSAGES.updateRaw);
            }
        });

        test("tags and geometry follow the create rules, with the same messages", async () => {
            const { place, scene } = await savedScene();
            await expectError(putScene(place, scene.id, { tags: 5 }), 400, MESSAGES.tags);
            await expectError(putScene(place, scene.id, { anchor_geometry: "nope" }), 400, MESSAGES.geometry);
        });

        test("reports the first invalid field in a fixed order", async () => {
            const { place, scene } = await savedScene();
            const order = [
                [{ start_time_seconds: "x" }, MESSAGES.updateTimingType],
                [{ start_time_seconds: -1 }, MESSAGES.updateTimingRange],
                [{ page_start: "x" }, MESSAGES.updatePagesType],
                [{ page_start: 0 }, MESSAGES.updatePagesRange],
                [{ start_offset: "x" }, MESSAGES.updateOffsetsType],
                [{ start_offset: -1 }, MESSAGES.updateOffsetsRange],
                [{ context_prefix: 1 }, MESSAGES.updateTextTypes],
                [{ tags: 5 }, MESSAGES.tags],
                [{ anchor_geometry: 5 }, MESSAGES.geometry],
                [{ raw_selected_text: "" }, MESSAGES.updateRaw],
            ];
            for (let index = 0; index < order.length; index += 1) {
                // Earlier entries are assigned last, so they win where two set the same field.
                const body = Object.assign({}, ...order.slice(index).reverse().map(([fields]) => fields));
                await expectError(putScene(place, scene.id, body), 400, order[index][1]);
            }
        });
    });

    describe("null and empty values", () => {
        // changes in 11: the text fields are replaced (A4)
        test("null formatted text clears it, and null or blank selected text falls back to formatted, then raw", async () => {
            const { place, scene } = await savedScene();

            const nulledFormatted = await putScene(place, scene.id, { formatted_selected_text: null });
            assert.equal(nulledFormatted.body.formatted_selected_text, null);
            assert.equal(nulledFormatted.body.selected_text, scene.selected_text);

            const toRaw = await putScene(place, scene.id, { selected_text: null });
            assert.equal(toRaw.body.selected_text, scene.raw_selected_text);

            const toFormatted = await putScene(place, scene.id, { selected_text: " ", formatted_selected_text: "Formatted" });
            assert.equal(toFormatted.body.selected_text, "Formatted");
        });

        test("null context clears it", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, { context_prefix: null, context_suffix: null });
            assert.equal(response.body.context_prefix, null);
            assert.equal(response.body.context_suffix, null);
        });

        test("null tags and null geometry become empty lists", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, { tags: null, anchor_geometry: null });
            assert.deepEqual(response.body.tags, []);
            assert.deepEqual(response.body.anchor_geometry, []);
        });

        // changes in 04: string tags and stringified geometry are rejected (B9)
        test("string tags are split and stringified geometry is parsed", async () => {
            const { place, scene } = await savedScene();
            const response = await putScene(place, scene.id, {
                tags: `${TAGS.revelation},${TAGS.protagonist}`,
                anchor_geometry: JSON.stringify(anchorPair({ startLine: 9 })),
            });
            assert.deepEqual(response.body.tags, [TAGS.revelation, TAGS.protagonist]);
            assert.deepEqual(response.body.anchor_geometry, anchorPair({ startLine: 9 }));
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
