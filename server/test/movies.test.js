import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import {
    assertSameRecords,
    createMovie,
    createMovieWithScript,
    createScene,
    movieBody,
    signedUrlPattern,
} from "./helpers/fixtures.js";

/*
 * Characterization of the movie routes: POST, GET, PUT and DELETE /movies.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const INVALID_MOVIE =
    "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) writer:string, (optional) cinematographer:string, (optional) cover_image_key:string }";

const MOVIE_FIELDS = [
    "cinematographer",
    "cover_image_key",
    "cover_image_url",
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

describe("creating a movie", () => {
    test("returns 201 with the movie and no cover URL", async () => {
        const body = movieBody();
        const response = await api.post("/movies", { cookie, body });
        assert.equal(response.status, 201, response.text);
        const movie = response.body;
        assert.deepEqual(Object.keys(movie).sort(), MOVIE_FIELDS);
        assert.match(movie.id, /^[0-9a-f-]{36}$/);
        assert.deepEqual(
            { ...movie, id: undefined, created_at: undefined },
            { ...body, id: undefined, created_at: undefined, cover_image_key: null, cover_image_url: null }
        );
        assert.ok(!Number.isNaN(Date.parse(movie.created_at)));
    });

    test("signs a view URL for the cover image", async () => {
        const key = `covers/${randomUUID()}/cover.jpg`;
        const movie = await createMovie(api, cookie, { cover_image_key: key });
        assert.equal(movie.cover_image_key, key);
        assert.match(movie.cover_image_url, signedUrlPattern(key));
    });

    test("requires the sign-in cookie", async () => {
        await expectError(api.post("/movies", { body: movieBody() }), 401, "Sign in to make changes.");
    });

    test("requires a string title and director and numeric year and runtime", async () => {
        const invalid = [
            without(movieBody(), "title"),
            movieBody({ director: 5 }),
            movieBody({ year: "2024" }),
            without(movieBody(), "runtime_minutes"),
            movieBody({ writer: 5 }),
            movieBody({ cinematographer: {} }),
        ];
        for (const body of invalid) {
            await expectError(api.post("/movies", { cookie, body }), 400, INVALID_MOVIE);
        }
    });

    test("accepts an empty title and director", async () => {
        const movie = await createMovie(api, cookie, { title: "", director: "" });
        assert.equal(movie.title, "");
        assert.equal(movie.director, "");
    });

    test("leaves range checks on year and runtime to the database, which makes them a 500", async (t) => {
        t.mock.method(console, "error", () => {});
        for (const body of [movieBody({ year: 1800 }), movieBody({ runtime_minutes: 0 }), movieBody({ year: 2024.5 })]) {
            await expectError(api.post("/movies", { cookie, body }), 500, "Something went wrong on the server.");
        }
    });

    test("a signed-in create with no body at all is a 400", async () => {
        await expectError(api.post("/movies", { cookie }), 400, INVALID_MOVIE);
    });

    test("requires the cover image key to be a string or null", async () => {
        for (const cover_image_key of [5, ["covers/a.jpg"], {}]) {
            await expectError(api.post("/movies", { cookie, body: movieBody({ cover_image_key }) }), 400, INVALID_MOVIE);
        }
    });

    test("trims writer and cinematographer, storing blank, null or missing values as null", async () => {
        assert.equal((await createMovie(api, cookie, { writer: "  Lee Moss  " })).writer, "Lee Moss");
        const blank = await createMovie(api, cookie, { writer: "   ", cinematographer: null });
        assert.equal(blank.writer, null);
        assert.equal(blank.cinematographer, null);
        const missing = await api.post("/movies", { cookie, body: without(movieBody(), "writer", "cinematographer") });
        assert.equal(missing.body.writer, null);
        assert.equal(missing.body.cinematographer, null);
    });

    test("ignores the removed links field", async () => {
        const movie = await createMovie(api, cookie, { links: ["https://a.example"] });
        assert.ok(!("links" in movie));
        const stored = await api.get(`/movies/${movie.id}`);
        assert.ok(!("links" in stored.body));
    });
});

describe("reading movies", () => {
    test("GET /movies is public and lists movies newest first, as they were saved", async () => {
        const older = await createMovie(api, cookie);
        const newer = await createMovie(api, cookie, { cover_image_key: `covers/${randomUUID()}/cover.png` });

        const response = await api.get("/movies");
        assert.equal(response.status, 200);
        const listed = response.body.filter((movie) => movie.id === older.id || movie.id === newer.id);
        assertSameRecords(listed, [newer, older]);
    });

    test("GET /movies/:id is public and answers 404 for a missing movie", async () => {
        const movie = await createMovie(api, cookie);
        const response = await api.get(`/movies/${movie.id}`);
        assert.equal(response.status, 200);
        assertSameRecords(response.body, movie);
        await expectError(api.get(`/movies/${randomUUID()}`), 404, "Movie not found");
    });
});

describe("updating a movie", () => {
    const COVER = `covers/${randomUUID()}/cover.webp`;

    async function savedMovie() {
        return createMovie(api, cookie, { cover_image_key: COVER });
    }

    test("returns 200 with the movie after replacing the fields it is sent", async () => {
        const movie = await savedMovie();
        const body = movieBody({
            title: "Day Diner",
            director: "Bo Kim",
            writer: "Ru Tan",
            cinematographer: "Jo Lee",
            year: 1999,
            runtime_minutes: 90,
            cover_image_key: `covers/${movie.id}/new.jpg`,
        });
        const response = await api.put(`/movies/${movie.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            { ...response.body, cover_image_url: undefined },
            { ...body, id: movie.id, created_at: movie.created_at, cover_image_url: undefined }
        );
        assert.match(response.body.cover_image_url, signedUrlPattern(body.cover_image_key));
    });

    test("keeps the saved cover, writer and cinematographer when they are left out", async () => {
        const movie = await savedMovie();
        const body = without(movieBody({ title: "Renamed" }), "writer", "cinematographer");
        const response = await api.put(`/movies/${movie.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assertSameRecords(response.body, { ...movie, title: "Renamed" });
    });

    test("clears the cover and credits when they are null", async () => {
        const movie = await savedMovie();
        const body = movieBody({ cover_image_key: null, writer: null, cinematographer: "  " });
        const response = await api.put(`/movies/${movie.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.cover_image_key, null);
        assert.equal(response.body.cover_image_url, null);
        assert.equal(response.body.writer, null);
        assert.equal(response.body.cinematographer, null);
    });

    test("still requires title, director, year and runtime, checked before the movie is looked up", async () => {
        const movie = await savedMovie();
        await expectError(api.put(`/movies/${movie.id}`, { cookie, body: without(movieBody(), "year") }), 400, INVALID_MOVIE);
        await expectError(api.put(`/movies/${randomUUID()}`, { cookie, body: without(movieBody(), "year") }), 400, INVALID_MOVIE);
        await expectError(api.put(`/movies/${randomUUID()}`, { cookie, body: movieBody() }), 404, "Movie not found");
    });

    test("requires the sign-in cookie", async () => {
        const movie = await savedMovie();
        await expectError(api.put(`/movies/${movie.id}`, { body: movieBody() }), 401, "Sign in to make changes.");
    });

    test("a signed-in update with no body at all is a 400", async () => {
        const movie = await savedMovie();
        await expectError(api.put(`/movies/${movie.id}`, { cookie }), 400, INVALID_MOVIE);
    });

    test("requires a string or null cover image key, checked before the movie is looked up", async () => {
        const movie = await savedMovie();
        await expectError(api.put(`/movies/${movie.id}`, { cookie, body: movieBody({ cover_image_key: 5 }) }), 400, INVALID_MOVIE);
        await expectError(api.put(`/movies/${randomUUID()}`, { cookie, body: movieBody({ cover_image_key: 5 }) }), 400, INVALID_MOVIE);
        assertSameRecords((await api.get(`/movies/${movie.id}`)).body, movie);
    });
});

describe("deleting a movie", () => {
    test("returns 204 and removes the movie with its script, captured scenes and stills", async () => {
        const place = await createMovieWithScript(api, cookie);
        const { movie, script } = place;
        await createScene(api, cookie, place);
        const still = await api.post(`/movies/${movie.id}/annotations`, { cookie, body: { time_seconds: 5 } });
        assert.equal(still.status, 201, still.text);

        const response = await api.delete(`/movies/${movie.id}`, { cookie });
        assert.equal(response.status, 204);
        assert.equal(response.text, "");

        await expectError(api.get(`/movies/${movie.id}`), 404, "Movie not found");
        await expectError(api.get(`/movies/${movie.id}/scripts`), 404, "Movie not found");
        assert.deepEqual((await api.get(`/movies/${movie.id}/annotations`)).body, []);
        assert.deepEqual((await api.get(`/movies/${movie.id}/scripts/${script.id}/scene-annotations`)).body, []);
    });

    test("answers 404 for a missing movie and requires the sign-in cookie", async () => {
        await expectError(api.delete(`/movies/${randomUUID()}`, { cookie }), 404, "Movie not found");
        const movie = await createMovie(api, cookie);
        await expectError(api.delete(`/movies/${movie.id}`), 401, "Sign in to make changes.");
    });
});
