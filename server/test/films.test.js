import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import {
    assertSameRecords,
    createFilm,
    createFilmWithScript,
    createScene,
    filmBody,
    signedUrlPattern,
} from "./helpers/fixtures.js";

/*
 * Characterization of the film routes: POST, GET, PUT and DELETE /movies.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const INVALID_FILM =
    "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) writer:string, (optional) cinematographer:string, (optional) cover_image_key:string }";

const FILM_FIELDS = [
    "cinematographer",
    "cover_image_key",
    "cover_image_url",
    "cover_image_url_expires_at",
    "created_at",
    "director",
    "id",
    "runtime_minutes",
    "title",
    "writer",
    "year",
];

async function expectError(responsePromise, status, error) {
    const response = await responsePromise;
    assert.equal(response.status, status, response.text);
    assert.deepEqual(response.body, { error });
}

function without(body, ...fields) {
    const copy = { ...body };
    for (const field of fields) delete copy[field];
    return copy;
}

describe("attaching a cover", () => {
    test("replays only the cover change and preserves newer film details", async () => {
        const film = await createFilm(api, cookie);
        const path = `/movies/${film.id}/cover`;
        const body = { cover_image_key: `covers/${film.id}/cover.png` };
        assert.equal((await api.put(path, { cookie, body })).status, 200);
        await api.put(`/movies/${film.id}`, { cookie, body: filmBody({ title: "Newer details" }) });
        const replay = await api.put(path, { cookie, body });
        assert.equal(replay.status, 200, replay.text);
        assert.equal(replay.body.title, "Newer details");
        assert.equal(replay.body.cover_image_key, body.cover_image_key);
        assert.match(replay.body.cover_image_url, signedUrlPattern(body.cover_image_key));
    });

    test("requires sign-in, validates the film's cover key and reports a missing film", async () => {
        const film = await createFilm(api, cookie);
        const path = `/movies/${film.id}/cover`;
        await expectError(api.put(path, { body: { cover_image_key: null } }), 401, "Sign in to make changes.");
        for (const body of [undefined, {}, { cover_image_key: 5 }, { cover_image_key: "covers/another-film/a.png" }]) {
            await expectError(api.put(path, { cookie, body }), 400, "Invalid cover image key for this film.");
        }
        await expectError(api.put(`/movies/${randomUUID()}/cover`, { cookie, body: { cover_image_key: null } }), 404, "Film not found");
    });
});

describe("creating a film", () => {
    test("replays concurrent creates with one identity without overwriting later edits", async () => {
        const id = randomUUID();
        const body = { ...filmBody(), id };
        const responses = await Promise.all([
            api.post("/movies", { cookie, body }), api.post("/movies", { cookie, body }),
        ]);
        for (const response of responses) {
            assert.equal(response.status, 201, response.text);
            assert.equal(response.body.id, id);
        }
        await api.put(`/movies/${id}`, { cookie, body: filmBody({ title: "Later edit" }) });
        const replay = await api.post("/movies", { cookie, body });
        assert.equal(replay.status, 201, replay.text);
        assert.equal(replay.body.title, "Later edit");
        const listing = await api.get("/movies");
        assert.equal(listing.body.filter((film) => film.id === id).length, 1);
    });

    test("rejects invalid supplied creation identities", async () => {
        for (const id of [null, 5, "not-a-uuid", ""]) {
            await expectError(api.post("/movies", { cookie, body: { ...filmBody(), id } }), 400, "Invalid film id. Expected a UUID.");
        }
    });

    test("returns 201 with the film and no cover URL", async () => {
        const body = filmBody();
        const response = await api.post("/movies", { cookie, body });
        assert.equal(response.status, 201, response.text);
        const film = response.body;
        assert.deepEqual(Object.keys(film).sort(), FILM_FIELDS);
        assert.match(film.id, /^[0-9a-f-]{36}$/);
        assert.deepEqual(
            { ...film, id: undefined, created_at: undefined },
            {
                ...body,
                id: undefined,
                created_at: undefined,
                cover_image_key: null,
                cover_image_url: null,
                cover_image_url_expires_at: null,
            }
        );
        assert.ok(!Number.isNaN(Date.parse(film.created_at)));
    });

    test("signs a view URL for the cover image", async () => {
        const key = `covers/${randomUUID()}/cover.jpg`;
        const film = await createFilm(api, cookie, { cover_image_key: key });
        assert.equal(film.cover_image_key, key);
        assert.match(film.cover_image_url, signedUrlPattern(key));
    });

    test("requires the sign-in cookie", async () => {
        await expectError(api.post("/movies", { body: filmBody() }), 401, "Sign in to make changes.");
    });

    test("requires a string title and director and numeric year and runtime", async () => {
        const invalid = [
            without(filmBody(), "title"),
            filmBody({ director: 5 }),
            filmBody({ year: "2024" }),
            without(filmBody(), "runtime_minutes"),
            filmBody({ writer: 5 }),
            filmBody({ cinematographer: {} }),
        ];
        for (const body of invalid) {
            await expectError(api.post("/movies", { cookie, body }), 400, INVALID_FILM);
        }
    });

    test("accepts an empty title and director", async () => {
        const film = await createFilm(api, cookie, { title: "", director: "" });
        assert.equal(film.title, "");
        assert.equal(film.director, "");
    });

    test("leaves range checks on year and runtime to the database, which makes them a 500", async (t) => {
        t.mock.method(console, "error", () => {});
        for (const body of [filmBody({ year: 1800 }), filmBody({ runtime_minutes: 0 }), filmBody({ year: 2024.5 })]) {
            await expectError(api.post("/movies", { cookie, body }), 500, "Something went wrong on the server.");
        }
    });

    test("a signed-in create with no body at all is a 400", async () => {
        await expectError(api.post("/movies", { cookie }), 400, INVALID_FILM);
    });

    test("requires the cover image key to be a string or null", async () => {
        for (const cover_image_key of [5, ["covers/a.jpg"], {}]) {
            await expectError(api.post("/movies", { cookie, body: filmBody({ cover_image_key }) }), 400, INVALID_FILM);
        }
    });

    test("trims writer and cinematographer, storing blank, null or missing values as null", async () => {
        assert.equal((await createFilm(api, cookie, { writer: "  Lee Moss  " })).writer, "Lee Moss");
        const blank = await createFilm(api, cookie, { writer: "   ", cinematographer: null });
        assert.equal(blank.writer, null);
        assert.equal(blank.cinematographer, null);
        const missing = await api.post("/movies", { cookie, body: without(filmBody(), "writer", "cinematographer") });
        assert.equal(missing.body.writer, null);
        assert.equal(missing.body.cinematographer, null);
    });

    test("ignores the removed links field", async () => {
        const film = await createFilm(api, cookie, { links: ["https://a.example"] });
        assert.ok(!("links" in film));
        const stored = await api.get(`/movies/${film.id}`);
        assert.ok(!("links" in stored.body));
    });
});

describe("reading films", () => {
    test("GET /movies is public and lists films newest first, as they were saved", async () => {
        const older = await createFilm(api, cookie);
        const newer = await createFilm(api, cookie, { cover_image_key: `covers/${randomUUID()}/cover.png` });

        const response = await api.get("/movies");
        assert.equal(response.status, 200);
        const listed = response.body.filter((film) => film.id === older.id || film.id === newer.id);
        assertSameRecords(listed, [newer, older]);
    });

    test("GET /movies/:id is public and answers 404 for a missing film", async () => {
        const film = await createFilm(api, cookie);
        const response = await api.get(`/movies/${film.id}`);
        assert.equal(response.status, 200);
        assertSameRecords(response.body, film);
        await expectError(api.get(`/movies/${randomUUID()}`), 404, "Film not found");
    });
});

describe("updating a film", () => {
    const COVER = `covers/${randomUUID()}/cover.webp`;

    async function savedFilm() {
        return createFilm(api, cookie, { cover_image_key: COVER });
    }

    test("returns 200 with the film after replacing the fields it is sent", async () => {
        const film = await savedFilm();
        const body = filmBody({
            title: "Day Diner",
            director: "Bo Kim",
            writer: "Ru Tan",
            cinematographer: "Jo Lee",
            year: 1999,
            runtime_minutes: 90,
            cover_image_key: `covers/${film.id}/new.jpg`,
        });
        const response = await api.put(`/movies/${film.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            { ...response.body, cover_image_url: undefined, cover_image_url_expires_at: undefined },
            {
                ...body,
                id: film.id,
                created_at: film.created_at,
                cover_image_url: undefined,
                cover_image_url_expires_at: undefined,
            }
        );
        assert.match(response.body.cover_image_url, signedUrlPattern(body.cover_image_key));
    });

    test("keeps the saved cover, writer and cinematographer when they are left out", async () => {
        const film = await savedFilm();
        const body = without(filmBody({ title: "Renamed" }), "writer", "cinematographer");
        const response = await api.put(`/movies/${film.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assertSameRecords(response.body, { ...film, title: "Renamed" });
    });

    test("clears the cover and credits when they are null", async () => {
        const film = await savedFilm();
        const body = filmBody({ cover_image_key: null, writer: null, cinematographer: "  " });
        const response = await api.put(`/movies/${film.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.cover_image_key, null);
        assert.equal(response.body.cover_image_url, null);
        assert.equal(response.body.writer, null);
        assert.equal(response.body.cinematographer, null);
    });

    test("still requires title, director, year and runtime, checked before the film is looked up", async () => {
        const film = await savedFilm();
        await expectError(api.put(`/movies/${film.id}`, { cookie, body: without(filmBody(), "year") }), 400, INVALID_FILM);
        await expectError(api.put(`/movies/${randomUUID()}`, { cookie, body: without(filmBody(), "year") }), 400, INVALID_FILM);
        await expectError(api.put(`/movies/${randomUUID()}`, { cookie, body: filmBody() }), 404, "Film not found");
    });

    test("requires the sign-in cookie", async () => {
        const film = await savedFilm();
        await expectError(api.put(`/movies/${film.id}`, { body: filmBody() }), 401, "Sign in to make changes.");
    });

    test("a signed-in update with no body at all is a 400", async () => {
        const film = await savedFilm();
        await expectError(api.put(`/movies/${film.id}`, { cookie }), 400, INVALID_FILM);
    });

    test("requires a string or null cover image key, checked before the film is looked up", async () => {
        const film = await savedFilm();
        await expectError(api.put(`/movies/${film.id}`, { cookie, body: filmBody({ cover_image_key: 5 }) }), 400, INVALID_FILM);
        await expectError(api.put(`/movies/${randomUUID()}`, { cookie, body: filmBody({ cover_image_key: 5 }) }), 400, INVALID_FILM);
        assertSameRecords((await api.get(`/movies/${film.id}`)).body, film);
    });
});

describe("deleting a film", () => {
    test("returns 204 and removes the film with its script, captured scenes and stills", async () => {
        const place = await createFilmWithScript(api, cookie);
        const { film, script } = place;
        await createScene(api, cookie, place);
        const still = await api.post(`/movies/${film.id}/annotations`, { cookie, body: { time_seconds: 5 } });
        assert.equal(still.status, 201, still.text);

        const response = await api.delete(`/movies/${film.id}`, { cookie });
        assert.equal(response.status, 204);
        assert.equal(response.text, "");

        await expectError(api.get(`/movies/${film.id}`), 404, "Film not found");
        await expectError(api.get(`/movies/${film.id}/scripts`), 404, "Film not found");
        assert.deepEqual((await api.get(`/movies/${film.id}/annotations`)).body, []);
        assert.deepEqual((await api.get(`/movies/${film.id}/scripts/${script.id}/scene-annotations`)).body, []);
    });

    test("answers 404 for a missing film and requires the sign-in cookie", async () => {
        await expectError(api.delete(`/movies/${randomUUID()}`, { cookie }), 404, "Film not found");
        const film = await createFilm(api, cookie);
        await expectError(api.delete(`/movies/${film.id}`), 401, "Sign in to make changes.");
    });
});
