function getLastName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  return (parts[parts.length - 1] || "").toLowerCase();
}

function safeYear(year) {
  const n = Number(year);
  return Number.isFinite(n) ? n : null;
}

export function getMovieCoverUrl(movie) {
  return movie?.cover_image_url || movie?.cover_url || "";
}

export function getMovieDirectors(movies) {
  return Array.from(new Set(movies.map((m) => m.director).filter(Boolean))).sort();
}

export function getMovieYears(movies) {
  const years = Array.from(
    new Set(movies.map((m) => safeYear(m.year)).filter((value) => value !== null))
  );
  years.sort((a, b) => b - a);
  return years;
}

function getMovieRecencyValue(movie) {
  const candidates = [movie?.updated_at, movie?.updatedAt, movie?.created_at, movie?.createdAt];
  for (const value of candidates) {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

/**
 * Picks the homepage preview set from real movie rows. If the backend does not
 * provide timestamps, the original API order remains the tie-breaker.
 */
export function getRecentMovies(movies, limit = 3) {
  return [...(Array.isArray(movies) ? movies : [])]
    .map((movie, index) => ({ movie, index }))
    .sort((a, b) => {
      const byRecency = getMovieRecencyValue(b.movie) - getMovieRecencyValue(a.movie);
      return byRecency || a.index - b.index;
    })
    .slice(0, limit)
    .map(({ movie }) => movie);
}

/**
 * Applies the archive page's stable filter/sort rules without mutating the
 * source movie array.
 */
export function filterAndSortMovies(movies, { query = "", director = "all", year = "all", sort = "az" }) {
  const q = query.trim().toLowerCase();

  const filtered = movies.filter((movie) => {
    const matchesTitle = String(movie.title || "").toLowerCase().includes(q);
    const matchesDirector = director === "all" || movie.director === director;
    const matchesYear = year === "all" || String(movie.year) === String(year);
    return matchesTitle && matchesDirector && matchesYear;
  });

  const list = [...filtered];

  switch (sort) {
    case "az":
      list.sort((a, b) => String(a.title).localeCompare(String(b.title)));
      break;
    case "za":
      list.sort((a, b) => String(b.title).localeCompare(String(a.title)));
      break;
    case "newest":
      list.sort((a, b) => (safeYear(b.year) ?? -1) - (safeYear(a.year) ?? -1));
      break;
    case "oldest":
      list.sort((a, b) => (safeYear(a.year) ?? 9999) - (safeYear(b.year) ?? 9999));
      break;
    case "directoraz":
      list.sort((a, b) => getLastName(a.director).localeCompare(getLastName(b.director)));
      break;
    case "directorza":
      list.sort((a, b) => getLastName(b.director).localeCompare(getLastName(a.director)));
      break;
    default:
      break;
  }

  return list;
}
