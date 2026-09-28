// client/src/pages/movies-list/ui/MoviesListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MOVIE_CREDITS } from "@/entities/movie/model/movieCredits.js";
import {
  filterAndSortMovies,
  getMovieCreditNames,
  getMovieYears,
} from "@/entities/movie/model/movieFilters.js";
import { MovieCard, MovieCardGrid, MovieCardSkeleton } from "@/entities/movie/ui/MovieCard.jsx";
import { useSession } from "@/entities/session/model/useSession.js";
import { deleteMovie, listMovies } from "@/shared/api/movies.js";
import { cx } from "@/shared/lib/cx.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { DropdownMenu } from "@/shared/ui/DropdownMenu.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { SearchIcon } from "@/shared/ui/icons.jsx";
import { Input, Select } from "@/shared/ui/Input.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import styles from "./MoviesListPage.module.css";

const SORT_OPTIONS = [
  { value: "az", label: "Title A–Z" },
  { value: "za", label: "Title Z–A" },
  { value: "newest", label: "Newest release" },
  { value: "oldest", label: "Oldest release" },
  ...MOVIE_CREDITS.flatMap(({ field, label }) => [
    { value: `${field}az`, label: `${label} A–Z` },
    { value: `${field}za`, label: `${label} Z–A` },
  ]),
];

const NO_CREDIT_FILTERS = Object.fromEntries(MOVIE_CREDITS.map(({ field }) => [field, "all"]));
const SKELETON_CARDS = 6;

export default function MoviesListPage() {
  const nav = useNavigate();
  const { isAdmin } = useSession();
  // Visitors browse the projects; the library is "mine" only once signed in, as in the header.
  const pageTitle = isAdmin ? "My Projects" : "Projects";
  useDocumentTitle(pageTitle);
  const [searchParams] = useSearchParams();
  const queryFromUrl = searchParams.get("query") || "";

  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // controls
  const [query, setQuery] = useState(queryFromUrl);
  const [sort, setSort] = useState("az");
  const [credits, setCredits] = useState(NO_CREDIT_FILTERS);
  const [year, setYear] = useState("all");
  // Phones fold sort and filters behind a toggle so posters stay near the top.
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMovies()
      .then((data) => {
        if (!cancelled) setMovies(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setErr(getErrorMessage(e, "Failed to load projects."));
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
      await deleteMovie(movie.id);
      setMovies((current) => current.filter((entry) => entry.id !== movie.id));
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to delete project."));
    } finally {
      setDeletingId(null);
    }
  }

  const creditNames = useMemo(
    () => Object.fromEntries(MOVIE_CREDITS.map(({ field }) => [field, getMovieCreditNames(movies, field)])),
    [movies]
  );
  const years = useMemo(() => getMovieYears(movies), [movies]);
  const filtered = useMemo(
    () => filterAndSortMovies(movies, { query, credits, year, sort }),
    [movies, query, credits, year, sort]
  );
  const activeFilterCount = Object.values(credits).filter((value) => value !== "all").length + (year !== "all" ? 1 : 0);
  const hasFilters = Boolean(query.trim()) || activeFilterCount > 0;

  function clearFilters() {
    setQuery("");
    setCredits(NO_CREDIT_FILTERS);
    setYear("all");
  }

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title={pageTitle}
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

        <Button
          className={styles.filtersToggle}
          aria-expanded={filtersOpen}
          aria-controls="project-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </Button>

        <div id="project-filters" className={cx(styles.filters, filtersOpen && styles.filtersOpen)}>
          <Select aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <Select aria-label="Filter by year" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </Select>

          {MOVIE_CREDITS.map(({ field, label, plural }) => (
            <Select
              key={field}
              aria-label={`Filter by ${label.toLowerCase()}`}
              value={credits[field]}
              onChange={(e) => setCredits((current) => ({ ...current, [field]: e.target.value }))}
            >
              <option value="all">All {plural}</option>
              {creditNames[field].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          ))}
        </div>
      </div>

      {err && (
        <Callout tone="error" className={styles.notice}>
          {err}
        </Callout>
      )}

      {loading ? (
        <div aria-busy="true" aria-label="Loading projects">
          <MovieCardGrid>
            {Array.from({ length: SKELETON_CARDS }, (_, index) => (
              <li key={index}>
                <MovieCardSkeleton />
              </li>
            ))}
          </MovieCardGrid>
        </div>
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
                isAdmin && (
                  <Button as={Link} to="/movies/new" variant="primary" size="sm">
                    Start a project
                  </Button>
                )
              }
            >
              {isAdmin
                ? "Create a project to upload a script and start annotating scenes."
                : "Projects will appear here once they're added."}
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
                  isAdmin ? (
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
                  ) : undefined
                }
              />
            </li>
          ))}
        </MovieCardGrid>
      )}
    </div>
  );
}
