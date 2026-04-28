// Centralizes the project's movie data model, including normalization, 
// local persistence, and view selectors.
import seedMovies from "../movies.json";

// This file is the movie "model" layer. It owns data normalization,
// persistence, CRUD helpers, and selectors used by the page controllers.
const MOVIES_STORAGE_KEY = "scriptdeck.movies";
const MOVIES_STORAGE_VERSION = 1;
export const DEFAULT_MOVIE_SORT = "recently-updated";

// Seeded movies point to a local cover by basename. Since the asset filenames
// match the values in movies.json, the lookup is direct.
const coverImageModules = import.meta.glob("../assets/images/covers/*.{png,jpg,jpeg,webp,avif}", {
  eager: true,
  import: "default",
});

const coverImageMap = Object.fromEntries(
  Object.entries(coverImageModules).map(([assetPath, assetUrl]) => [
    assetPath.split("/").pop().replace(/\.[^.]+$/u, ""),
    assetUrl,
  ]),
);

// Builds an accessible checkbox id for one filter option.
export function createFilterOptionId(sectionKey, option) {
  return `${sectionKey}-${option}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// Extracts the four-digit release year for compact display.
export function formatMovieReleaseYear(releaseDate) {
  if (!releaseDate) {
    return "";
  }

  return String(releaseDate).slice(0, 4);
}

// Collects only the external resource links that actually exist for a movie.
export function getMovieResourceLinks(movie) {
  return [
    movie.wiki || movie.wikipedia
      ? { key: "wiki", label: "Open Wiki", href: movie.wiki || movie.wikipedia }
      : null,
    movie.script ? { key: "script", label: "Open Script", href: movie.script } : null,
    movie.trailer ? { key: "trailer", label: "Watch Trailer", href: movie.trailer } : null,
  ].filter(Boolean);
}

// Resolves a seeded cover image name into the bundled asset URL.
function resolveCoverImage(coverImage) {
  if (!coverImage) {
    return "";
  }

  if (
    coverImage.startsWith("data:") ||
    coverImage.startsWith("http://") ||
    coverImage.startsWith("https://") ||
    coverImage.startsWith("/")
  ) {
    return coverImage;
  }

  return coverImageMap[coverImage] || "";
}

// Normalizes one movie so the rest of the app can rely on a consistent shape.
export function normalizeMovie(movie, index = 0) {
  const createdAt =
    movie.createdAt || movie.updatedAt || movie.releaseDate || new Date().toISOString();
  const updatedAt = movie.updatedAt || createdAt;
  const genre = Array.isArray(movie.genre)
    ? movie.genre.filter(Boolean)
    : movie.genre
      ? [movie.genre]
      : [];

  return {
    id: movie.id || `movie-${index + 1}`,
    title: movie.title || "",
    director: movie.director || "",
    cinematographer: movie.cinematographer || "",
    writer: movie.writer || "",
    runtime: movie.runtime || "",
    genre,
    rating: movie.rating || "",
    wiki: movie.wiki || movie.wikipedia || "",
    script: movie.script || "",
    trailer: movie.trailer || "",
    coverImage: resolveCoverImage(movie.coverImage || ""),
    releaseDate: movie.releaseDate || createdAt.slice(0, 10),
    createdAt,
    updatedAt,
  };
}

// Normalizes a whole movie list from either JSON seed data or local storage.
function normalizeMovieList(movies) {
  if (!Array.isArray(movies)) {
    return [];
  }

  return movies.map((movie, index) => normalizeMovie(movie, index));
}

// Creates a client-side id for newly added projects.
function createMovieId(title) {
  const slug = (title || "project")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${slug || "project"}-${Date.now()}`;
}

// Builds a lightweight lookup key used when merging seeded and saved movies.
function createMovieMatchKey(movie) {
  return (movie?.title || "").trim().toLowerCase();
}

// Merges the seeded dataset with stored user data while keeping custom entries.
function mergeSeedAndStoredMovies(seedList, storedList) {
  // Older saved data may not include the latest seeded entries, so this merges
  // by title to keep user-created items while still exposing the full dataset.
  const storedByTitle = new Map(storedList.map((movie) => [createMovieMatchKey(movie), movie]));
  const seedTitles = new Set(seedList.map((movie) => createMovieMatchKey(movie)));

  const mergedSeedMovies = seedList.map((movie) => {
    const storedMovie = storedByTitle.get(createMovieMatchKey(movie));
    return storedMovie
      ? {
          ...movie,
          ...storedMovie,
        }
      : movie;
  });

  const customMovies = storedList.filter((movie) => !seedTitles.has(createMovieMatchKey(movie)));

  return [...customMovies, ...mergedSeedMovies];
}

// Returns a sorted list of unique non-empty values.
function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((firstValue, secondValue) =>
    firstValue.localeCompare(secondValue),
  );
}

// Checks whether a movie matches the current free-text search query.
function matchesSearch(movie, query) {
  if (!query) {
    return true;
  }

  const searchableText = [
    movie.title,
    movie.director,
    movie.cinematographer,
    movie.writer,
    movie.rating,
    ...(movie.genre || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchableText.includes(query.toLowerCase());
}

// Checks whether a movie matches every active structured filter.
function matchesFilters(movie, selectedFilters) {
  return Object.entries(selectedFilters).every(([filterKey, values]) => {
    if (!values.length) {
      return true;
    }

    if (filterKey === "genre") {
      return values.some((value) => (movie.genre || []).includes(value));
    }

    return values.includes(movie[filterKey]);
  });
}

// Loads the movie dataset from local storage first, then uses the seed JSON when needed.
export function loadMovies(storage = typeof window !== "undefined" ? window.localStorage : null) {
  const normalizedSeedMovies = normalizeMovieList(seedMovies);

  if (!storage) {
    return normalizedSeedMovies;
  }

  try {
    const storedMovies = storage.getItem(MOVIES_STORAGE_KEY);

    if (storedMovies) {
      const parsedMovies = JSON.parse(storedMovies);

      // Support the earlier plain-array format and the current versioned object
      // so the project still loads cleanly after refactors.
      if (Array.isArray(parsedMovies)) {
        return mergeSeedAndStoredMovies(normalizedSeedMovies, normalizeMovieList(parsedMovies));
      }

      if (parsedMovies?.version === MOVIES_STORAGE_VERSION && Array.isArray(parsedMovies.movies)) {
        return normalizeMovieList(parsedMovies.movies);
      }

      if (Array.isArray(parsedMovies?.movies)) {
        return normalizeMovieList(parsedMovies.movies);
      }
    }
  } catch (error) {
    console.error("Unable to read stored movies.", error);
  }

  return normalizedSeedMovies;
}

// Persists the current movie list to local storage using the versioned shape.
export function saveMovies(movies, storage = typeof window !== "undefined" ? window.localStorage : null) {
  if (!storage) {
    return;
  }

  storage.setItem(
    MOVIES_STORAGE_KEY,
    JSON.stringify({
      version: MOVIES_STORAGE_VERSION,
      movies,
    }),
  );
}

// Finds a single movie by id.
export function getMovieById(movies, movieId) {
  return movies.find((movie) => movie.id === movieId);
}

// Creates a new normalized movie and returns the next movie list.
export function createMovie(movies, payload) {
  const timestamp = new Date().toISOString();
  const nextMovie = normalizeMovie(
    {
      ...payload,
      id: createMovieId(payload.title),
      createdAt: timestamp,
      updatedAt: timestamp,
      releaseDate: payload.releaseDate || timestamp.slice(0, 10),
    },
    movies.length,
  );

  return [nextMovie, ...movies];
}

// Replaces one movie by id and updates its timestamp.
export function updateMovie(movies, movieId, payload) {
  const timestamp = new Date().toISOString();

  return movies.map((movie, index) => {
    if (movie.id !== movieId) {
      return movie;
    }

    return normalizeMovie(
      {
        ...movie,
        ...payload,
        id: movie.id,
        createdAt: movie.createdAt,
        updatedAt: timestamp,
        releaseDate: payload.releaseDate || movie.releaseDate,
      },
      index,
    );
  });
}

// Removes one movie from the dataset by id.
export function deleteMovie(movies, movieId) {
  return movies.filter((movie) => movie.id !== movieId);
}

// Sorts the movies according to the selected sort option.
function sortMovies(movies, sortBy = DEFAULT_MOVIE_SORT) {
  const sortedMovies = [...movies];

  if (sortBy === "title-asc") {
    return sortedMovies.sort((firstMovie, secondMovie) =>
      firstMovie.title.localeCompare(secondMovie.title),
    );
  }

  if (sortBy === "title-desc") {
    return sortedMovies.sort((firstMovie, secondMovie) =>
      secondMovie.title.localeCompare(firstMovie.title),
    );
  }

  if (sortBy === "release-newest") {
    return sortedMovies.sort(
      (firstMovie, secondMovie) =>
        new Date(secondMovie.releaseDate).getTime() - new Date(firstMovie.releaseDate).getTime(),
    );
  }

  if (sortBy === "release-oldest") {
    return sortedMovies.sort(
      (firstMovie, secondMovie) =>
        new Date(firstMovie.releaseDate).getTime() - new Date(secondMovie.releaseDate).getTime(),
    );
  }

  return sortedMovies.sort(
    (firstMovie, secondMovie) =>
      new Date(secondMovie.updatedAt).getTime() - new Date(firstMovie.updatedAt).getTime(),
  );
}

// Returns the most recently updated movies for the Explore page.
export function getRecentMovies(movies, limit = 3) {
  return sortMovies(movies, DEFAULT_MOVIE_SORT).slice(0, limit);
}

// Builds the filter sidebar sections from the current movie dataset.
export function getFilterSections(movies) {
  return [
    {
      key: "director",
      title: "Director",
      options: uniqueValues(movies.map((movie) => movie.director)),
    },
    {
      key: "cinematographer",
      title: "Cinematographer",
      options: uniqueValues(movies.map((movie) => movie.cinematographer)),
    },
    {
      key: "writer",
      title: "Writer",
      options: uniqueValues(movies.map((movie) => movie.writer)),
    },
    {
      key: "genre",
      title: "Genre",
      options: uniqueValues(movies.flatMap((movie) => movie.genre || [])),
    },
    {
      key: "rating",
      title: "Rating",
      options: uniqueValues(movies.map((movie) => movie.rating)),
    },
  ];
}

// Applies search, filters, and sorting to produce the final visible movie list.
export function getVisibleMovies(
  movies,
  {
    query = "",
    selectedFilters = {},
    sortBy = DEFAULT_MOVIE_SORT,
  } = {},
) {
  // My Projects uses one selector so search/filter/sort all stay consistent.
  const filteredMovies = movies.filter(
    (movie) => matchesSearch(movie, query.trim()) && matchesFilters(movie, selectedFilters),
  );

  return sortMovies(filteredMovies, sortBy);
}
