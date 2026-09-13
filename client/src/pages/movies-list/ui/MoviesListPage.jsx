// client/src/pages/movies-list/ui/MoviesListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  filterAndSortMovies,
  getMovieDirectors,
  getMovieYears,
  MovieCard,
  MovieCardGrid,
} from "@/entities/movie";
import { movieActions } from "@/features/movie-actions";
import { api } from "@/shared/api";
import {
  Button,
  Callout,
  DropdownMenu,
  EmptyState,
  Input,
  LoadingState,
  PageHeader,
  SearchIcon,
  Select,
} from "@/shared/ui";
import styles from "./MoviesListPage.module.css";

const SORT_OPTIONS = [
  { value: "az", label: "Title A–Z" },
  { value: "za", label: "Title Z–A" },
  { value: "newest", label: "Newest release" },
  { value: "oldest", label: "Oldest release" },
  { value: "directoraz", label: "Director A–Z" },
  { value: "directorza", label: "Director Z–A" },
];

export default function MoviesListPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const queryFromUrl = searchParams.get("query") || "";

  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // controls
  const [query, setQuery] = useState(queryFromUrl);
  const [sort, setSort] = useState("az");
  const [director, setDirector] = useState("all");
  const [year, setYear] = useState("all");

  useEffect(() => {
    let cancelled = false;
    api
      .listMovies()
      .then((data) => {
        if (!cancelled) setMovies(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Failed to load projects");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setQuery(queryFromUrl);
  }, [queryFromUrl]);

  async function onDeleteMovie(movie) {
    const confirmed = window.confirm(`Delete "${movie.title}"? This cannot be undone.`);
    if (!confirmed) return;

    setErr("");
    setDeletingId(movie.id);

    try {
      await movieActions.delete(movie.id);
      setMovies((current) => current.filter((entry) => entry.id !== movie.id));
    } catch (e) {
      setErr(e.message || "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  }

  const directors = useMemo(() => getMovieDirectors(movies), [movies]);
  const years = useMemo(() => getMovieYears(movies), [movies]);
  const filtered = useMemo(
    () => filterAndSortMovies(movies, { query, director, year, sort }),
    [movies, query, director, year, sort]
  );
  const hasFilters = Boolean(query.trim()) || director !== "all" || year !== "all";

  function clearFilters() {
    setQuery("");
    setDirector("all");
    setYear("all");
  }

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="My Projects"
        description={loading ? undefined : `${movies.length} project${movies.length === 1 ? "" : "s"}`}
      />

      <div className={styles.toolbar}>
        <Input
          icon={<SearchIcon />}
          className={styles.search}
          type="search"
          placeholder="Search by title…"
          aria-label="Search projects by title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <Select className={styles.filter} aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          className={styles.filter}
          aria-label="Filter by director"
          value={director}
          onChange={(e) => setDirector(e.target.value)}
        >
          <option value="all">All directors</option>
          {directors.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>

        <Select className={styles.filter} aria-label="Filter by year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </Select>
      </div>

      {err && (
        <Callout tone="error" className={styles.notice}>
          {err}
        </Callout>
      )}

      {loading ? (
        <LoadingState>Loading projects…</LoadingState>
      ) : filtered.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title="No projects match your filters"
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          !err && (
            <EmptyState
              title="No projects yet"
              action={
                <Button as={Link} to="/movies/new" variant="primary" size="sm">
                  Start a project
                </Button>
              }
            >
              Create a project to upload a script and start annotating scenes.
            </EmptyState>
          )
        )
      ) : (
        <MovieCardGrid>
          {filtered.map((movie) => (
            <li key={movie.id}>
              <MovieCard
                movie={movie}
                headingLevel={2}
                menu={
                  <DropdownMenu
                    label={`Actions for ${movie.title}`}
                    triggerVariant="overlay"
                    items={[
                      {
                        key: "edit",
                        label: "Edit details",
                        onSelect: () => nav(`/movies/${movie.id}/edit`),
                      },
                      {
                        key: "delete",
                        label: deletingId === movie.id ? "Deleting…" : "Delete",
                        tone: "danger",
                        disabled: deletingId === movie.id,
                        onSelect: () => onDeleteMovie(movie),
                      },
                    ]}
                  />
                }
              />
            </li>
          ))}
        </MovieCardGrid>
      )}
    </div>
  );
}
