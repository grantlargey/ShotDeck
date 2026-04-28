// client/src/pages/movies-list/ui/MoviesListPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  filterAndSortMovies,
  getMovieCoverUrl,
  getMovieDirectors,
  getMovieYears,
} from "@/entities/movie";
import { movieActions } from "@/features/movie-actions";
import { api } from "@/shared/api";
import styles from "./MoviesListPage.module.css";

export default function MoviesListPage() {
  const nav = useNavigate();

  const [movies, setMovies] = useState([]);
  const [err, setErr] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // controls
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("az");
  const [director, setDirector] = useState("all");
  const [year, setYear] = useState("all");

  // kebab menu state
  const [openMenuId, setOpenMenuId] = useState(null);
  const rootRef = useRef(null);

  async function load() {
    setErr("");
    try {
      const data = await api.listMovies();
      setMovies(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e.message || "Failed to load movies");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDeleteMovie(movie) {
    const confirmed = window.confirm(`Delete "${movie.title}"? This cannot be undone.`);
    if (!confirmed) return;

    setErr("");
    setDeletingId(movie.id);

    try {
      await movieActions.delete(movie.id);
      setMovies((current) => current.filter((entry) => entry.id !== movie.id));
      setOpenMenuId(null);
    } catch (e) {
      setErr(e.message || "Failed to delete movie");
    } finally {
      setDeletingId(null);
    }
  }

  // close menus on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const directors = useMemo(() => {
    return getMovieDirectors(movies);
  }, [movies]);

  const years = useMemo(() => {
    return getMovieYears(movies);
  }, [movies]);

  const filtered = useMemo(() => {
    return filterAndSortMovies(movies, { query, director, year, sort });
  }, [movies, query, director, year, sort]);

  return (
    <div ref={rootRef}>
      <h1 className={styles.title}>Archive of Entries</h1>

      {err && <div className={styles.error}>{err}</div>}

      <div className={styles.controls}>
        <input
          className={styles.control}
          type="text"
          placeholder="Search by title..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          className={styles.control}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="az">Sort by Title A-Z</option>
          <option value="za">Sort by Title Z-A</option>
          <option value="newest">Sort by Release Date (Newest)</option>
          <option value="oldest">Sort by Release Date (Oldest)</option>
          <option value="directoraz">Sort by Director A-Z</option>
          <option value="directorza">Sort by Director Z-A</option>
        </select>

        <select
          className={styles.control}
          value={director}
          onChange={(e) => setDirector(e.target.value)}
        >
          <option value="all">All Directors</option>
          {directors.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <select
          className={styles.control}
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value="all">All Years</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>No movies yet.</div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((m) => {
            const thumb = getMovieCoverUrl(m);
            const menuOpen = openMenuId === m.id;

            return (
              <li key={m.id} className={styles.item} onClick={() => nav(`/movies/${m.id}`)}>
                <Link
                  className={styles.entryWrapper}
                  to={`/movies/${m.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {thumb ? (
                    <img
                      className={styles.thumb}
                      src={thumb}
                      alt={`${m.title} cover`}
                      loading="lazy"
                      onError={(e) => {
                        // avoids broken-image icon; falls back to blank thumb
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className={styles.thumb} aria-hidden="true" />
                  )}

                  <span className={styles.entryLink}>{m.title}</span>

                  <span className={styles.entryMeta}>
                    {m.director} • {m.year}
                  </span>
                </Link>

                <button
                  className={styles.menuButton}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenMenuId((cur) => (cur === m.id ? null : m.id));
                  }}
                  aria-label="Menu"
                >
                  ⋮
                </button>

                <div className={`${styles.menu} ${menuOpen ? styles.menuShow : ""}`}>
                  <div
                    className={styles.menuItem}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(null);
                      nav(`/movies/${m.id}/edit`);
                    }}
                  >
                    Edit
                  </div>

                  <div
                    className={styles.menuItem}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (deletingId === m.id) return;
                      setOpenMenuId(null);
                      onDeleteMovie(m);
                    }}
                  >
                    {deletingId === m.id ? "Deleting..." : "Delete"}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
