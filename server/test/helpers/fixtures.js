import assert from "node:assert/strict";

/*
 * Request bodies shaped like the client's, and records made through the API.
 */

/** A presigned S3 view URL for `key`, signed locally with the test run's dummy bucket and region. */
export function signedUrlPattern(key) {
    const host = `${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^https://${escape(host)}/${escape(key)}\\?.*X-Amz-Signature=[0-9a-f]+`);
}

const SIGNED_URL_KEYS = {
    cover_image_url: "cover_image_key",
    image_url: "image_key",
    thumb_url: "thumb_key",
    script_url: "s3_key",
};

/**
 * Asserts that two API records, or two lists of them, are equal apart from their
 * signed view URLs, which change every UTC hour. Each URL must still be signed
 * for its record's key, or be null when the record has no key.
 */
export function assertSameRecords(actual, expected) {
    const comparable = (record) => {
        const copy = { ...record };
        for (const [urlField, keyField] of Object.entries(SIGNED_URL_KEYS)) {
            if (!(urlField in copy)) continue;
            if (copy[keyField]) assert.match(copy[urlField], signedUrlPattern(copy[keyField]), urlField);
            else assert.equal(copy[urlField], null, urlField);
            copy[urlField] = "(signed view URL)";
        }
        return copy;
    };
    const normalize = (value) => (Array.isArray(value) ? value.map(comparable) : comparable(value));
    assert.deepEqual(normalize(actual), normalize(expected));
}

export const TAGS = {
    protagonist: "character-focus:protagonist",
    revelation: "narrative-function:revelation",
    selfConflict: "conflict-type:character-vs-self",
};

export function movieBody(overrides = {}) {
    return {
        title: "Night Diner",
        director: "Ada Park",
        writer: "Lee Moss",
        cinematographer: "Sam Ortiz",
        year: 2024,
        runtime_minutes: 118,
        ...overrides,
    };
}

export async function createMovie(api, cookie, overrides = {}) {
    const response = await api.post("/movies", { cookie, body: movieBody(overrides) });
    assert.equal(response.status, 201, response.text);
    return response.body;
}

export async function saveScript(api, cookie, movie) {
    const response = await api.post(`/movies/${movie.id}/scripts`, {
        cookie,
        body: { s3_key: `scripts/${movie.id}/script.pdf` },
    });
    assert.equal(response.status, 201, response.text);
    return response.body;
}

/** A movie with its script, ready for captured scenes. */
export async function createMovieWithScript(api, cookie) {
    const movie = await createMovie(api, cookie);
    return { movie, script: await saveScript(api, cookie, movie) };
}

/** A version-2 scene anchor pair, as the script viewer saves it. */
export function anchorPair({ startPage = 1, startLine = 0, endPage = startPage, endLine = startLine + 4 } = {}) {
    return [
        {
            kind: "start",
            version: 2,
            unit: "pt",
            page: startPage,
            line: startLine,
            top: 100 + startLine * 12,
            bottom: 112 + startLine * 12,
            text: "INT. NIGHT DINER - NIGHT",
        },
        {
            kind: "end",
            version: 2,
            unit: "pt",
            page: endPage,
            line: endLine,
            top: 100 + endLine * 12,
            bottom: 112 + endLine * 12,
            text: "Mara pours the coffee.",
        },
    ];
}

const SCENE_TEXT = "## INT. NIGHT DINER - NIGHT\n\nMara pours the coffee.";

// Each body gets its own lines, so scenes in one script share a line only when a
// test passes the same anchor_geometry on purpose.
let nextStartLine = 0;

/** A captured-scene body shaped like the script viewer's save payload. */
export function sceneBody(overrides = {}) {
    const startLine = nextStartLine;
    nextStartLine += 10;
    return {
        start_time_seconds: 60,
        end_time_seconds: 120,
        selected_text: SCENE_TEXT,
        raw_selected_text: "INT. NIGHT DINER - NIGHT\nMara pours the coffee.",
        formatted_selected_text: SCENE_TEXT,
        page_start: 1,
        page_end: 1,
        start_offset: 10,
        end_offset: 58,
        context_prefix: "FADE IN:",
        context_suffix: "She sits.",
        anchor_geometry: anchorPair({ startLine }),
        tags: [TAGS.protagonist],
        ...overrides,
    };
}

export function scenesPath({ movie, script }) {
    return `/movies/${movie.id}/scripts/${script.id}/scene-annotations`;
}

export async function createScene(api, cookie, place, overrides = {}) {
    const response = await api.post(scenesPath(place), { cookie, body: sceneBody(overrides) });
    assert.equal(response.status, 201, response.text);
    return response.body;
}
