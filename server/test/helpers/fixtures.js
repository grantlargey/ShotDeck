import assert from "node:assert/strict";

/*
 * Request bodies shaped like the client's, and records made through the API.
 */

/**
 * A presigned view URL for `key`, signed locally with the test run's dummy
 * credentials. It points wherever this run configured S3: a custom endpoint is
 * addressed path-style, and AWS keeps its virtual-hosted bucket hostname.
 * server/test/s3-endpoint.test.js pins both shapes.
 */
export function signedUrlPattern(key) {
    const endpoint =
        process.env.S3_PUBLIC_ENDPOINT || process.env.AWS_ENDPOINT_URL_S3 || process.env.AWS_ENDPOINT_URL;
    const base = endpoint
        ? `${new URL(endpoint).origin}/${process.env.S3_BUCKET}`
        : `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escape(base)}/${escape(key)}\\?.*X-Amz-Signature=[0-9a-f]+`);
}

/**
 * When a presigned URL stops working, read from the signature it carries the way a
 * browser can: the moment it was signed, in ISO basic format, and the seconds it
 * lasts from there.
 */
export function signedUrlExpiry(url) {
    const query = new URL(url).searchParams;
    const [, ...stamp] = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(query.get("X-Amz-Date"));
    const [year, month, day, hour, minute, second] = stamp.map(Number);
    return Date.UTC(year, month - 1, day, hour, minute, second) + Number(query.get("X-Amz-Expires")) * 1000;
}

const SIGNED_URL_KEYS = {
    cover_image_url: "cover_image_key",
    image_url: "image_key",
    thumb_url: "thumb_key",
    script_url: "s3_key",
};

/**
 * Asserts that two API records, or two lists of them, are equal apart from their
 * signed view URLs and the moments those expire, both of which change every UTC
 * hour. Each URL must still be signed for its record's key and expire at some
 * point, or both must be null when the record has no key.
 */
export function assertSameRecords(actual, expected) {
    const comparable = (record) => {
        const copy = { ...record };
        for (const [urlField, keyField] of Object.entries(SIGNED_URL_KEYS)) {
            if (!(urlField in copy)) continue;
            const expiryField = `${urlField}_expires_at`;
            if (copy[keyField]) {
                assert.match(copy[urlField], signedUrlPattern(copy[keyField]), urlField);
                assert.ok(!Number.isNaN(Date.parse(copy[expiryField])), expiryField);
            } else {
                assert.equal(copy[urlField], null, urlField);
                assert.equal(copy[expiryField], null, expiryField);
            }
            copy[urlField] = "(signed view URL)";
            copy[expiryField] = "(when it expires)";
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

export async function saveScript(api, cookie, movie, overrides = {}) {
    const response = await api.post(`/movies/${movie.id}/scripts`, {
        cookie,
        body: { s3_key: `scripts/${movie.id}/script.pdf`, ...overrides },
    });
    assert.equal(response.status, 201, response.text);
    return response.body;
}

/** A movie with its script, ready for captured scenes. */
export async function createMovieWithScript(api, cookie, overrides = {}) {
    const movie = await createMovie(api, cookie, overrides);
    return { movie, script: await saveScript(api, cookie, movie) };
}

/**
 * A scene anchor pair, as the script viewer saves it. Anchors are baselines in
 * PDF points; a screenplay's leading is 12pt, so line N sits 12pt below line 0.
 */
export function anchorPair({ startPage = 1, startLine = 0, endPage = startPage, endLine = startLine + 4 } = {}) {
    return {
        start: { page: startPage, y: 96 + startLine * 12 },
        end: { page: endPage, y: 96 + endLine * 12 },
    };
}

const SCENE_TEXT = "## INT. NIGHT DINER - NIGHT\n\nMara pours the coffee.";

// Each body gets its own page, so scenes in one script share a location only
// when a test passes the same script_location on purpose. Tests that build a
// pair by hand use the low pages, so these start well above them.
const FIRST_GENERATED_PAGE = 100;
let nextStartPage = FIRST_GENERATED_PAGE;

/** A captured-scene body shaped like the script viewer's save payload. */
export function sceneBody(overrides = {}) {
    const startPage = nextStartPage;
    nextStartPage = nextStartPage >= 300 ? FIRST_GENERATED_PAGE : nextStartPage + 1;
    return {
        start_time_seconds: 60,
        end_time_seconds: 120,
        script_location: anchorPair({ startPage }),
        scene_text: SCENE_TEXT,
        tags: [TAGS.protagonist],
        ...overrides,
    };
}

export function scenesPath({ movie, script }) {
    return `/movies/${movie.id}/scripts/${script.id}/scene-annotations`;
}

export async function createScene(api, cookie, place, overrides = {}) {
    const response = await api.post(scenesPath(place), { cookie, body: sceneBody({ script_key: place.script.s3_key, ...overrides }) });
    assert.equal(response.status, 201, response.text);
    return response.body;
}
