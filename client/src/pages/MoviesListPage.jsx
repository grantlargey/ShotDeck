// client/src/pages/MovieListPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import styles from "./MoviesListPage.module.css";

function getLastName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  return (parts[parts.length - 1] || "").toLowerCase();
}

function safeYear(y) {
  const n = Number(y);
  return Number.isFinite(n) ? n : null;
}

// FIX: backend now returns either cover_image_url (signed) or cover_url (public/cloudfront)
// so handle both (and fall back to empty string).
function getThumbUrl(movie) {
  return movie?.cover_image_url || movie?.cover_url || "";
}

export default function MoviesListPage() {
  const nav = useNavigate();

  const [movies, setMovies] = useState([]);
  const [err, setErr] = useState("");

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
    return Array.from(new Set(movies.map((m) => m.director).filter(Boolean))).sort();
  }, [movies]);

  const years = useMemo(() => {
    const ys = Array.from(
      new Set(movies.map((m) => safeYear(m.year)).filter((v) => v !== null))
    );
    ys.sort((a, b) => b - a);
    return ys;
  }, [movies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = movies.filter((m) => {
      const matchesTitle = String(m.title || "").toLowerCase().includes(q);
      const matchesDirector = director === "all" || m.director === director;
      const matchesYear = year === "all" || String(m.year) === String(year);
      return matchesTitle && matchesDirector && matchesYear;
    });

    // IMPORTANT: don't mutate state array; sort a copy
    list = [...list];

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
            const thumb = getThumbUrl(m);
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
                      setOpenMenuId(null);
                      alert("Delete not wired yet (needs a DELETE /movies/:id endpoint).");
                    }}
                  >
                    Delete
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