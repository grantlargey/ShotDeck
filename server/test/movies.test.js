import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { signInOwner, startApi } from "./helpers/api.js";
import { createMovie, createMovieWithScript, createScene, movieBody, signedUrlPattern } from "./helpers/fixtures.js";

/*
 * Characterization of the movie routes: POST, GET, PUT and DELETE /movies.
 *
 * "changes in NN" marks behavior that overhaul issue NN is expected to change.
 */

const api = await startApi();
const { cookie } = await signInOwner(api);

const INVALID_MOVIE =
    "Invalid body. Expected { title:string, director:string, year:number, runtime_minutes:number, (optional) writer:string, (optional) cinematographer:string, (optional) cover_image_key:string, (optional) links:string[] }";
// changes in 11: movie links are removed (A8)
const INVALID_LINKS = "Invalid body. 'links' must be an array of strings (or a newline-separated string).";

// changes in 11: no links (A8)
const MOVIE_FIELDS = [
    "cinematographer",
    "cover_image_key",
    "cover_image_url",
    "created_at",
    "director",
    "id",
    "links",
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
    test("returns 201 with the movie, no cover URL and empty links", async () => {
        const body = movieBody();
        const response = await api.post("/movies", { cookie, body });
        assert.equal(response.status, 201, response.text);
        const movie = response.body;
        assert.deepEqual(Object.keys(movie).sort(), MOVIE_FIELDS);
        assert.match(movie.id, /^[0-9a-f-]{36}$/);
        assert.deepEqual(
            { ...movie, id: undefined, created_at: undefined },
            { ...body, id: undefined, created_at: undefined, cover_image_key: null, cover_image_url: null, links: [] }
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

    test("trims writer and cinematographer, storing blank, null or missing values as null", async () => {
        assert.equal((await createMovie(api, cookie, { writer: "  Lee Moss  " })).writer, "Lee Moss");
        const blank = await createMovie(api, cookie, { writer: "   ", cinematographer: null });
        assert.equal(blank.writer, null);
        assert.equal(blank.cinematographer, null);
        const missing = await api.post("/movies", { cookie, body: without(movieBody(), "writer", "cinematographer") });
        assert.equal(missing.body.writer, null);
        assert.equal(missing.body.cinematographer, null);
    });

    // changes in 11: movie links are removed (A8)
    describe("links", () => {
        test("are trimmed, blanks dropped and values turned into strings; null is an empty list", async () => {
            assert.deepEqual((await createMovie(api, cookie, { links: [" https://a.example ", "", 5] })).links, [
                "https://a.example",
                "5",
            ]);
            assert.deepEqual((await createMovie(api, cookie, { links: null })).links, []);
        });

        // changes in 05: string links are rejected (B9)
        test("accept a newline-separated string", async () => {
            const movie = await createMovie(api, cookie, { links: "https://a.example\r\n\n https://b.example " });
            assert.deepEqual(movie.links, ["https://a.example", "https://b.example"]);
        });

        test("that are neither a list nor a string are a 400, reported after the other fields", async () => {
            await expectError(api.post("/movies", { cookie, body: movieBody({ links: 5 }) }), 400, INVALID_LINKS);
            await expectError(
                api.post("/movies", { cookie, body: movieBody({ links: 5, title: null }) }),
                400,
                INVALID_MOVIE
            );
        });
    });
});

describe("reading movies", () => {
    test("GET /movies is public and lists movies newest first, as they were saved", async () => {
        const older = await createMovie(api, cookie);
        const newer = await createMovie(api, cookie, { cover_image_key: `covers/${randomUUID()}/cover.png` });

        const response = await api.get("/movies");
        assert.equal(response.status, 200);
        const listed = response.body.filter((movie) => movie.id === older.id || movie.id === newer.id);
        assert.deepEqual(listed, [newer, older]);
    });

    test("GET /movies/:id is public and answers 404 for a missing movie", async () => {
        const movie = await createMovie(api, cookie);
        const response = await api.get(`/movies/${movie.id}`);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, movie);
        await expectError(api.get(`/movies/${randomUUID()}`), 404, "Movie not found");
    });
});

describe("updating a movie", () => {
    const COVER = `covers/${randomUUID()}/cover.webp`;

    async function savedMovie() {
        return createMovie(api, cookie, { cover_image_key: COVER, links: ["https://a.example"] });
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
            links: ["https://b.example"],
        });
        const response = await api.put(`/movies/${movie.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(
            { ...response.body, cover_image_url: undefined },
            { ...body, id: movie.id, created_at: movie.created_at, cover_image_url: undefined }
        );
        assert.match(response.body.cover_image_url, signedUrlPattern(body.cover_image_key));
    });

    test("keeps the saved cover, writer, cinematographer and links when they are left out", async () => {
        const movie = await savedMovie();
        const body = without(movieBody({ title: "Renamed" }), "writer", "cinematographer");
        const response = await api.put(`/movies/${movie.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(response.body, { ...movie, title: "Renamed" });
    });

    test("clears the cover and credits when they are null, and links when null", async () => {
        const movie = await savedMovie();
        const body = movieBody({ cover_image_key: null, writer: null, cinematographer: "  ", links: null });
        const response = await api.put(`/movies/${movie.id}`, { cookie, body });
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.cover_image_key, null);
        assert.equal(response.body.cover_image_url, null);
        assert.equal(response.body.writer, null);
        assert.equal(response.body.cinematographer, null);
        assert.deepEqual(response.body.links, []);
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
        assert.deepEqual((await api.get(`/movies/${movie.id}/scripts`)).body, []);
        assert.deepEqual((await api.get(`/movies/${movie.id}/annotations`)).body, []);
        assert.deepEqual((await api.get(`/movies/${movie.id}/scripts/${script.id}/scene-annotations`)).body, []);
    });

    test("answers 404 for a missing movie and requires the sign-in cookie", async () => {
        await expectError(api.delete(`/movies/${randomUUID()}`, { cookie }), 404, "Movie not found");
        const movie = await createMovie(api, cookie);
        await expectError(api.delete(`/movies/${movie.id}`), 401, "Sign in to make changes.");
    });
});
