import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import { signedUrlPattern } from "./helpers/fixtures.js";

/*
 * Characterization of POST /uploads/presign and GET /uploads/view-url.
 * Presigning happens locally; nothing is uploaded.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const INVALID_PRESIGN =
    'Invalid body. Expected { movieId:string, type:"cover"|"annotation"|"script", contentType:"image/*"| "application/pdf" }';

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

function presign(body, options = { cookie }) {
    return api.post("/uploads/presign", { ...options, body });
}

describe("presigning an upload", () => {
    test("renews the same upload identity and allocates a different key for a replacement", async () => {
        const body = { movieId: randomUUID(), type: "script", contentType: "application/pdf", uploadId: randomUUID() };
        const first = await presign(body);
        const retry = await presign(body);
        const replacement = await presign({ ...body, uploadId: randomUUID() });
        assert.equal(first.status, 200, first.text);
        assert.equal(retry.status, 200, retry.text);
        assert.equal(retry.body.key, first.body.key);
        assert.notEqual(replacement.body.key, first.body.key);
        assert.ok(new URL(retry.body.uploadUrl).pathname.endsWith(`/${first.body.key}`));
    });

    test("rejects invalid supplied upload identities", async () => {
        for (const uploadId of [null, 5, "not-a-uuid", ""]) {
            await expectError(presign({ movieId: randomUUID(), type: "cover", contentType: "image/png", uploadId }), 400, "Invalid upload id. Expected a UUID.");
        }
    });

    test("returns a new key under the type's folder and a 5-minute PUT URL for it", async () => {
        const movieId = randomUUID();
        const cases = [
            ["cover", "image/png", "covers", "png"],
            ["cover", "image/jpeg", "covers", "jpg"],
            ["cover", "image/avif", "covers", "avif"],
            ["annotation", "image/webp", "annotations", "webp"],
            ["annotation", "image/gif", "annotations", "gif"],
            ["annotation", "image/heic", "annotations", "jpg"],
            ["script", "application/pdf", "scripts", "pdf"],
        ];
        for (const [type, contentType, folder, extension] of cases) {
            const response = await presign({ movieId, type, contentType });
            assert.equal(response.status, 200, response.text);
            assert.deepEqual(Object.keys(response.body).sort(), ["key", "uploadUrl"]);

            const { key, uploadUrl } = response.body;
            assert.match(key, new RegExp(`^${folder}/${movieId}/[0-9a-f-]{36}\\.${extension}$`));
            const url = new URL(uploadUrl);
            assert.ok(url.pathname.endsWith(`/${key}`), uploadUrl);
            assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
            // Only the host is signed: the signature doesn't bind the content type.
            assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
            assert.match(url.searchParams.get("X-Amz-Signature"), /^[0-9a-f]{64}$/);
        }
    });

    test("doesn't check the movie exists, and turns the movie id into one safe path segment", async () => {
        const response = await presign({ movieId: " my movie/../x ", type: "cover", contentType: "image/png" });
        assert.equal(response.status, 200, response.text);
        assert.match(response.body.key, /^covers\/my_movie_\.\._x\/[0-9a-f-]{36}\.png$/);
    });

    test("a movie id with no usable characters is a 500", async (t) => {
        t.mock.method(console, "error", () => {});
        for (const movieId of ["", "///"]) {
            await expectError(presign({ movieId, type: "cover", contentType: "image/png" }), 500, "Something went wrong on the server.");
        }
    });

    test("requires a string movie id, a known type and a content type that suits it", async () => {
        const movieId = randomUUID();
        const invalid = [
            {},
            { movieId: 5, type: "cover", contentType: "image/png" },
            { movieId, type: "poster", contentType: "image/png" },
            { movieId, type: "cover" },
            { movieId, type: "cover", contentType: "application/pdf" },
            { movieId, type: "script", contentType: "image/png" },
        ];
        for (const body of invalid) {
            await expectError(presign(body), 400, INVALID_PRESIGN);
        }
    });

    test("requires the sign-in cookie", async () => {
        await expectError(presign({ movieId: randomUUID(), type: "cover", contentType: "image/png" }, {}), 401, "Sign in to make changes.");
    });

    test("a signed-in request with no body at all is a 400", async () => {
        await expectError(api.post("/uploads/presign", { cookie }), 400, INVALID_PRESIGN);
    });
});

describe("signing a view URL", () => {
    test("is public and signs keys under covers/, annotations/ and scripts/", async () => {
        for (const key of ["covers/m/a.jpg", "annotations/m/b.png", "scripts/m/c.pdf"]) {
            const response = await api.get(`/uploads/view-url?key=${encodeURIComponent(key)}`);
            assert.equal(response.status, 200, response.text);
            assert.deepEqual(Object.keys(response.body), ["url"]);
            assert.match(response.body.url, signedUrlPattern(key));
        }
    });

    test("rejects a missing or short key, and any other folder", async () => {
        await expectError(api.get("/uploads/view-url"), 400, "Missing or invalid key");
        await expectError(api.get("/uploads/view-url?key=ab"), 400, "Missing or invalid key");
        await expectError(api.get("/uploads/view-url?key=other/m/a.jpg"), 400, "Invalid key prefix");
    });
});
