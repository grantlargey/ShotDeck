import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/*
 * Where presigned URLs point. src/s3.js reads its configuration once at import,
 * so each case signs a URL in its own process with its own environment.
 *
 * Production signs AWS's virtual-hosted hostname. Local development points the
 * API at an S3-compatible container instead, and a containerized API reaches
 * that container by a different host than the browser does.
 */

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = "scriptdeck-url-shape";

const SIGN = `
import { createPresignedPutUrl, createPresignedGetUrl } from "./src/s3.js";
const put = await createPresignedPutUrl({ key: "covers/m/a.jpg", contentType: "image/jpeg" });
const get = await createPresignedGetUrl({ key: "covers/m/a.jpg" });
console.log(JSON.stringify({ put: put.uploadUrl, get: get.url }));
`;

/** Signs one PUT and one GET in a child process configured by `overrides`. */
function sign(overrides) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", SIGN], {
        cwd: serverDir,
        encoding: "utf8",
        timeout: 30_000,
        env: {
            PATH: process.env.PATH,
            AWS_REGION: "us-east-1",
            S3_BUCKET: BUCKET,
            AWS_ACCESS_KEY_ID: "url-shape-key",
            AWS_SECRET_ACCESS_KEY: "url-shape-secret",
            AWS_EC2_METADATA_DISABLED: "true",
            AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "false",
            // Set even when empty: dotenv never overrides a variable that
            // already exists, so a developer's server/.env can't reach these.
            AWS_ENDPOINT_URL_S3: "",
            AWS_ENDPOINT_URL: "",
            S3_PUBLIC_ENDPOINT: "",
            ...overrides,
        },
    });
    assert.equal(result.status, 0, `signing failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
}

function assertSigned(url, expectedBase) {
    const parsed = new URL(url);
    assert.equal(`${parsed.origin}${parsed.pathname}`, expectedBase);
    assert.match(parsed.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]+$/);
}

test("with no endpoint, URLs are AWS virtual-hosted, as production serves them", () => {
    const { put, get } = sign({});
    const expected = `https://${BUCKET}.s3.us-east-1.amazonaws.com/covers/m/a.jpg`;
    assertSigned(put, expected);
    assertSigned(get, expected);
});

test("a custom endpoint is addressed path-style, so local development needs no AWS", () => {
    const { put, get } = sign({ AWS_ENDPOINT_URL_S3: "http://127.0.0.1:9000" });
    const expected = `http://127.0.0.1:9000/${BUCKET}/covers/m/a.jpg`;
    assertSigned(put, expected);
    assertSigned(get, expected);
});

test("S3_PUBLIC_ENDPOINT signs the host the browser reaches, not the one the API sends to", () => {
    const { put, get } = sign({
        AWS_ENDPOINT_URL_S3: "http://s3:9000",
        S3_PUBLIC_ENDPOINT: "http://127.0.0.1:9000",
    });
    const expected = `http://127.0.0.1:9000/${BUCKET}/covers/m/a.jpg`;
    assertSigned(put, expected);
    assertSigned(get, expected);
});

test("the generic AWS_ENDPOINT_URL is honoured when no S3-specific one is set", () => {
    const { get } = sign({ AWS_ENDPOINT_URL: "http://127.0.0.1:9000" });
    assertSigned(get, `http://127.0.0.1:9000/${BUCKET}/covers/m/a.jpg`);
});
