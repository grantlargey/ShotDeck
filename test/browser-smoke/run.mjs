import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { makeSyntheticPdf } from "./make-pdf.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const requireServer = createRequire(path.join(root, "server/package.json"));
const { Client } = requireServer("pg");
const blockerUrl = pathToFileURL(path.join(here, "block-external-network.mjs")).href;
const databaseName = `shotdeck_test_16_smoke_${process.pid}_${randomBytes(3).toString("hex")}`;
const adminUrl = new URL(process.env.SMOKE_DATABASE_ADMIN_URL || "postgres://app:app@127.0.0.1:5432/postgres");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
databaseUrl.search = "";

if (!["postgres:", "postgresql:"].includes(adminUrl.protocol)) {
  throw new Error("SMOKE_DATABASE_ADMIN_URL must use the postgres protocol.");
}
if (!loopbackHosts.has(adminUrl.hostname)) {
  throw new Error("SMOKE_DATABASE_ADMIN_URL must use a loopback hostname.");
}
if (adminUrl.pathname !== "/postgres") {
  throw new Error("SMOKE_DATABASE_ADMIN_URL must name the postgres administrative database.");
}
if (!/^shotdeck_test_16_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error(`Refusing unsafe smoke database name: ${databaseName}`);
}

const children = [];
const portReservations = [];
let browser;
let database;
let databaseCreated = false;
let s3Stub;
let cleanupPromise;
let shuttingDown = false;

class SmokeShutdown extends Error {}

function throwIfShuttingDown() {
  if (shuttingDown) throw new SmokeShutdown("Browser smoke interrupted.");
}

function pass(message) {
  throwIfShuttingDown();
  console.log(`PASS ${message}`);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const reservation = { port, released: false, server };
  portReservations.push(reservation);
  throwIfShuttingDown();
  return reservation;
}

async function releasePort(reservation) {
  if (reservation.released) return;
  reservation.released = true;
  await new Promise((resolve, reject) => {
    reservation.server.close((error) => (error ? reject(error) : resolve()));
  });
}

function safeEnvironment(overrides) {
  return {
    ...process.env,
    ...overrides,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${blockerUrl}`].filter(Boolean).join(" "),
  };
}

function startChild(name, command, args, options) {
  throwIfShuttingDown();
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  child.smokeSpawnError = null;
  child.once("error", (error) => {
    child.smokeSpawnError = error;
  });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
  children.push(child);
  return child;
}

async function runChild(name, command, args, options) {
  const child = startChild(name, command, args, options);
  const result = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("exit", (exitCode) => resolve({ code: exitCode ?? 1 }));
  });
  const index = children.indexOf(child);
  if (index >= 0) children.splice(index, 1);
  if (result.error) throw result.error;
  if (result.code !== 0) throw new Error(`${name} exited with status ${result.code}.`);
}

async function waitFor(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    throwIfShuttingDown();
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` ${lastError.message}` : ""}`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.smokeSpawnError || !child.pid) return;
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("close", resolve);
    child.once("error", resolve);
  });
  if (!child.kill("SIGTERM")) return;
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
}

async function attemptCleanup(label, operation, errors) {
  try {
    await operation();
  } catch (error) {
    errors.push(new Error(`${label}: ${error.message}`, { cause: error }));
  }
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const errors = [];
    if (browser) await attemptCleanup("close browser", () => browser.close(), errors);
    for (const [index, child] of children.toReversed().entries()) {
      await attemptCleanup(`stop child ${index + 1}`, () => stopChild(child), errors);
    }
    for (const reservation of portReservations) {
      await attemptCleanup(`release reserved port ${reservation.port}`, () => releasePort(reservation), errors);
    }
    if (database) await attemptCleanup("close application database connection", () => database.end(), errors);
    if (s3Stub) {
      await attemptCleanup(
        "close S3 stub",
        () => new Promise((resolve, reject) => s3Stub.close((error) => (error ? reject(error) : resolve()))),
        errors
      );
    }
    if (databaseCreated) {
      await attemptCleanup("drop throwaway database", async () => {
        const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });
        try {
          await admin.connect();
          await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
          console.log(`Removed throwaway database ${databaseName}.`);
        } finally {
          await admin.end().catch(() => {});
        }
      }, errors);
    }
    if (errors.length) throw new AggregateError(errors, "Browser smoke cleanup failed.");
  })();
  return cleanupPromise;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = 1;
    console.error(`Received ${signal}; requesting browser smoke cleanup.`);
  });
}

async function placeAnchor(page, pageNumber, lineNumber, baseline, key) {
  throwIfShuttingDown();
  const frame = page.locator(`#script-page-${pageNumber}`);
  await frame.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const pdfBox = await frame.locator(".react-pdf__Page").boundingBox();
  assert(pdfBox, `PDF page ${pageNumber} has a rendered box`);
  const x = pdfBox.x + pdfBox.width * 0.45;
  const y = pdfBox.y + (baseline - 3.5) * (pdfBox.width / 612);
  await page.mouse.move(x, y - 3);
  await page.mouse.move(x, y);
  await frame.getByText(`L${lineNumber + 1}`, { exact: true }).waitFor();
  await page.keyboard.press(key);
  throwIfShuttingDown();
}

async function setTiming(panel, start, end) {
  throwIfShuttingDown();
  await panel.getByRole("textbox", { name: "Start", exact: true }).fill(start);
  await panel.getByRole("textbox", { name: "End", exact: true }).fill(end);
  throwIfShuttingDown();
}

const movieId = randomUUID();
const scriptId = randomUUID();
const userId = randomUUID();
const stillId = randomUUID();
const password = `Smoke-${randomBytes(12).toString("base64url")}`;
const email = "browser-smoke@example.test";
const bucket = "scriptdeck-browser-smoke";
const pdf = makeSyntheticPdf();
const s3Requests = [];

try {
  const appReservation = await reservePort();
  const apiReservation = await reservePort();
  const s3Reservation = await reservePort();
  const appPort = appReservation.port;
  const apiPort = apiReservation.port;
  const s3Port = s3Reservation.port;
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const s3Origin = `http://127.0.0.1:${s3Port}`;

  s3Stub = createServer((request, response) => {
    s3Requests.push({ method: request.method, url: request.url });
    response.writeHead(404, { "Content-Type": "application/xml" });
    response.end("<Error><Code>NoSuchKey</Code><Message>synthetic smoke stub</Message></Error>");
  });
  await releasePort(s3Reservation);
  throwIfShuttingDown();
  await new Promise((resolve, reject) => {
    s3Stub.once("error", reject);
    s3Stub.listen(s3Port, "127.0.0.1", resolve);
  });
  throwIfShuttingDown();

  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });
  await admin.connect();
  try {
    throwIfShuttingDown();
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    throwIfShuttingDown();
    assert.equal(existing.rowCount, 0, `throwaway database ${databaseName} does not already exist`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    throwIfShuttingDown();
  } finally {
    await admin.end();
  }
  throwIfShuttingDown();

  const serverEnvironment = safeEnvironment({
    DATABASE_URL: databaseUrl.toString(),
    PORT: String(apiPort),
    ALLOWED_ORIGINS: appOrigin,
    AWS_REGION: "us-east-1",
    S3_BUCKET: bucket,
    AWS_ACCESS_KEY_ID: "smoke-access-key",
    AWS_SECRET_ACCESS_KEY: "smoke-secret-key",
    AWS_SESSION_TOKEN: "",
    AWS_PROFILE: "",
    AWS_ENDPOINT_URL_S3: s3Origin,
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "false",
    AWS_MAX_ATTEMPTS: "1",
    AWS_EC2_METADATA_DISABLED: "true",
    OPENAI_API_KEY: "",
  });
  await runChild("migrate", process.execPath, ["src/migrate.js"], {
    cwd: path.join(root, "server"),
    env: serverEnvironment,
  });
  throwIfShuttingDown();

  database = new Client({ connectionString: databaseUrl.toString(), connectionTimeoutMillis: 5_000 });
  await database.connect();
  throwIfShuttingDown();
  const { hashPassword } = await import(pathToFileURL(path.join(root, "server/src/utils/passwords.js")));
  throwIfShuttingDown();
  await database.query(
    "INSERT INTO admin_users(id, email, password_hash) VALUES ($1, $2, $3)",
    [userId, email, await hashPassword(password)]
  );
  await database.query(
    "INSERT INTO movies(id, title, director, year, runtime_minutes) VALUES ($1, $2, $3, $4, $5)",
    [movieId, "Browser smoke film", "Synthetic Director", 2026, 120]
  );
  await database.query("INSERT INTO scripts(id, movie_id, s3_key) VALUES ($1, $2, $3)", [
    scriptId,
    movieId,
    "scripts/smoke/script.pdf",
  ]);
  await database.query(
    "INSERT INTO annotations(id, movie_id, time_seconds, image_key) VALUES ($1, $2, 1, $3)",
    [stillId, movieId, "annotations/smoke/still.png"]
  );
  throwIfShuttingDown();

  await releasePort(apiReservation);
  throwIfShuttingDown();
  startChild("api", process.execPath, ["src/index.js"], {
    cwd: path.join(root, "server"),
    env: serverEnvironment,
  });
  await waitFor(async () => (await fetch(`${apiOrigin}/health`)).ok, "the real API");
  await waitFor(() => s3Requests.length > 0, "an S3 send to reach the local stub");
  assert(s3Requests.every(({ url }) => url.includes("annotations/smoke/still.png")));
  pass("the real API runs on a side port and S3 sends terminate at the loopback stub");

  await releasePort(appReservation);
  throwIfShuttingDown();
  startChild("vite", process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(appPort)], {
    cwd: path.join(root, "client"),
    env: safeEnvironment({ VITE_API_BASE: apiOrigin }),
  });
  await waitFor(async () => (await fetch(appOrigin)).ok, "the side-port Vite app");

  browser = await chromium.launch({
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  throwIfShuttingDown();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  context.setDefaultTimeout(30_000);
  const interceptedExternal = [];
  const interceptedFonts = [];
  const blockedExternal = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin || url.origin === apiOrigin) return route.continue();
    if (
      url.protocol === "https:" &&
      url.hostname === `${bucket}.s3.us-east-1.amazonaws.com` &&
      url.pathname === "/scripts/smoke/script.pdf"
    ) {
      interceptedExternal.push(url.toString());
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "Access-Control-Allow-Origin": appOrigin },
        body: pdf,
      });
    }
    if (url.protocol === "https:" && url.hostname === "fonts.googleapis.com") {
      interceptedFonts.push(url.toString());
      return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    }
    blockedExternal.push(url.toString());
    return route.abort("blockedbyclient");
  });

  const login = await context.request.post(`${apiOrigin}/auth/login`, { data: { email, password } });
  assert.equal(login.status(), 200);
  assert((await context.cookies()).some((cookie) => cookie.name === "sd_admin" && cookie.httpOnly));
  pass("real authentication creates the admin session used by browser writes");

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("dialog", (dialog) => dialog.accept());
  const sceneWrites = [];
  const scenesPath = `/movies/${movieId}/scripts/${scriptId}/scene-annotations`;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(scenesPath) && ["POST", "PUT", "DELETE"].includes(request.method())) {
      sceneWrites.push({ method: request.method(), url: url.toString() });
    }
  });

  const viewerUrl = `${appOrigin}/movies/${movieId}/scripts/${scriptId}`;
  const panel = page.getByRole("complementary", { name: "Scene annotator" });
  async function ready() {
    throwIfShuttingDown();
    await panel.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".react-pdf__Page canvas").length === 3 &&
        !document.body.innerText.includes("Indexing script text"),
      null,
      { timeout: 60_000 }
    );
    throwIfShuttingDown();
  }

  await page.goto(viewerUrl);
  await ready();
  await placeAnchor(page, 1, 0, 96, "[");
  await placeAnchor(page, 1, 7, 216, "]");
  await setTiming(panel, "00:10:00", "00:11:00");
  const createdResponsePromise = page.waitForResponse(
    (response) => response.url() === apiOrigin + scenesPath && response.request().method() === "POST"
  );
  await panel.getByRole("button", { name: "Save scene", exact: true }).click();
  const createdResponse = await createdResponsePromise;
  assert.equal(createdResponse.status(), 201);
  const saved = await createdResponse.json();
  assert.deepEqual(Object.keys(saved).sort(), [
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
  ]);
  assert.deepEqual(Object.keys(saved.script_location).sort(), ["end", "start"]);
  assert.deepEqual(Object.keys(saved.script_location.start).sort(), ["bottom", "line", "page", "text", "top"]);
  assert.deepEqual(Object.keys(saved.script_location.end).sort(), ["bottom", "line", "page", "text", "top"]);
  assert.equal(saved.start_time_seconds, 600);
  assert.equal(saved.end_time_seconds, 660);
  assert.equal(saved.script_location.start.page, 1);
  assert.equal(saved.script_location.start.line, 0);
  assert.equal(saved.script_location.end.page, 1);
  assert.equal(saved.script_location.end.line, 7);
  assert(saved.scene_text.includes("INT. DINER - NIGHT"));
  assert(saved.raw_text.includes("Coffee is all I can do."));
  assert.deepEqual(saved.tags, []);
  for (const retired of ["anchor_geometry", "formatted_selected_text", "raw_selected_text", "selected_text"]) {
    assert.equal(Object.hasOwn(saved, retired), false, `${retired} is absent from the canonical response`);
  }

  const stored = await database.query("SELECT * FROM captured_scenes WHERE id = $1", [saved.id]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].start_page, saved.script_location.start.page);
  assert.equal(stored.rows[0].start_line, saved.script_location.start.line);
  assert.equal(stored.rows[0].end_page, saved.script_location.end.page);
  assert.equal(stored.rows[0].end_line, saved.script_location.end.line);
  assert.equal(stored.rows[0].scene_text, saved.scene_text);
  assert.equal(stored.rows[0].raw_text, saved.raw_text);
  assert.deepEqual(stored.rows[0].tags, []);
  pass("capture and save persist the exact canonical HTTP fields in captured_scenes");

  await page.reload();
  await ready();
  const grid = page.getByRole("region", { name: /^Scenes in this script/ });
  await grid.getByText("00:10:00 – 00:11:00", { exact: true }).click();
  assert.equal(await panel.getByRole("textbox", { name: "Start", exact: true }).inputValue(), "00:10:00");
  await panel.getByText("Start · p. 1 · line 1", { exact: true }).waitFor();
  await panel.getByText("End · p. 1 · line 8", { exact: true }).waitFor();
  pass("reload restores canonical text, timing, and script location from the real API");

  await panel.getByRole("textbox", { name: "End", exact: true }).fill("00:11:06");
  const updateResponsePromise = page.waitForResponse(
    (response) => response.url() === `${apiOrigin}${scenesPath}/${saved.id}` && response.request().method() === "PUT"
  );
  await panel.getByRole("button", { name: "Update scene", exact: true }).click();
  const updateResponse = await updateResponsePromise;
  assert.equal(updateResponse.status(), 200);
  assert.equal((await updateResponse.json()).end_time_seconds, 666);
  assert.equal(
    (await database.query("SELECT end_time_seconds FROM captured_scenes WHERE id = $1", [saved.id])).rows[0]
      .end_time_seconds,
    666
  );
  await page.goto(`${viewerUrl}?sceneId=${saved.id}`);
  await ready();
  assert.equal(await panel.getByRole("textbox", { name: "End", exact: true }).inputValue(), "00:11:06");
  pass("update persists and deep-link reload restores the canonical scene");

  await panel.getByRole("button", { name: "New scene", exact: true }).click();
  await placeAnchor(page, 3, 0, 96, "[");
  await placeAnchor(page, 3, 4, 168, "]");
  await setTiming(panel, "00:10:30", "00:11:30");
  const writesBeforeTimingRefusal = sceneWrites.length;
  await panel.getByRole("button", { name: "Save scene", exact: true }).click();
  await page.getByText(/film timing overlaps the scene at 00:10:00 – 00:11:06/).waitFor();
  await page.waitForTimeout(250);
  assert.equal(sceneWrites.length, writesBeforeTimingRefusal);
  pass("the client refuses a film-timing overlap before sending a request");

  await panel.getByRole("button", { name: "New scene", exact: true }).click();
  await placeAnchor(page, 1, 0, 96, "[");
  await placeAnchor(page, 1, 7, 216, "]");
  await setTiming(panel, "00:12:00", "00:13:00");
  await panel.getByText(/These anchors share lines with the scene at 00:10:00/).waitFor();
  const writesBeforeLocationRefusal = sceneWrites.length;
  await panel.getByRole("button", { name: "Save scene", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(sceneWrites.length, writesBeforeLocationRefusal);
  pass("the client refuses a script-location overlap before sending a request");

  await grid.getByText("00:10:00 – 00:11:06", { exact: true }).click();
  const deleteResponsePromise = page.waitForResponse(
    (response) => response.url() === `${apiOrigin}${scenesPath}/${saved.id}` && response.request().method() === "DELETE"
  );
  await panel.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal((await deleteResponsePromise).status(), 204);
  assert.equal((await database.query("SELECT count(*)::int AS count FROM captured_scenes")).rows[0].count, 0);
  await page.reload();
  await ready();
  assert.equal(await grid.getByText("00:10:00 – 00:11:06", { exact: true }).count(), 0);
  pass("delete persists and remains deleted after reload");

  assert(interceptedExternal.length >= 1, "each signed PDF load was fulfilled inside Playwright");
  assert(interceptedFonts.length >= 1, "external font stylesheets were replaced inside Playwright");
  assert.deepEqual(blockedExternal, [], "no unexpected browser request reached an external origin");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert(s3Requests.length >= 1);
  pass("external sockets are blocked; the signed PDF and S3 traffic use synthetic local stubs");
} catch (error) {
  if (!shuttingDown) throw error;
} finally {
  await cleanup();
}
