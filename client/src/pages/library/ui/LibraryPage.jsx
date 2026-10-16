// client/src/pages/library/ui/LibraryPage.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FILM_CREDITS } from "@/entities/film/model/filmCredits.js";
import {
  filterAndSortFilms,
  getFilmCreditNames,
  getFilmYears,
} from "@/entities/film/model/filmFilters.js";
import { FilmCard, FilmCardGrid, FilmCardSkeleton } from "@/entities/film/ui/FilmCard.jsx";
import { useSession } from "@/entities/session/model/useSession.js";
import { deleteFilm, listFilms } from "@/shared/api/films.js";
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
import styles from "./LibraryPage.module.css";

const SORT_OPTIONS = [
  { value: "az", label: "Title A–Z" },
  { value: "za", label: "Title Z–A" },
  { value: "newest", label: "Newest release" },
  { value: "oldest", label: "Oldest release" },
  ...FILM_CREDITS.flatMap(({ field, label }) => [
    { value: `${field}az`, label: `${label} A–Z` },
    { value: `${field}za`, label: `${label} Z–A` },
  ]),
];

const NO_CREDIT_FILTERS = Object.fromEntries(FILM_CREDITS.map(({ field }) => [field, "all"]));
const SKELETON_CARDS = 6;

export default function LibraryPage() {
  const nav = useNavigate();
  const { isAdmin } = useSession();
  useDocumentTitle("Library");
  const [searchParams] = useSearchParams();
  const queryFromUrl = searchParams.get("query") || "";

  const [films, setFilms] = useState([]);
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
    listFilms()
      .then((data) => {
        if (!cancelled) setFilms(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setErr(getErrorMessage(e, "Failed to load films."));
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

  async function onDeleteFilm(film) {
    const confirmed = window.confirm(`Delete "${film.title}"? This cannot be undone.`);
    if (!confirmed) return;

    setErr("");
    setDeletingId(film.id);

    try {
      await deleteFilm(film.id);
      setFilms((current) => current.filter((entry) => entry.id !== film.id));
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to delete film."));
    } finally {
      setDeletingId(null);
    }
  }

  const creditNames = useMemo(
    () => Object.fromEntries(FILM_CREDITS.map(({ field }) => [field, getFilmCreditNames(films, field)])),
    [films]
  );
  const years = useMemo(() => getFilmYears(films), [films]);
  const filtered = useMemo(
    () => filterAndSortFilms(films, { query, credits, year, sort }),
    [films, query, credits, year, sort]
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
        title="Library"
        description={loading ? undefined : `${films.length} film${films.length === 1 ? "" : "s"}`}
      />

      <div className={styles.toolbar}>
        <Input
          icon={<SearchIcon />}
          className={styles.search}
          type="search"
          placeholder="Search by title…"
          aria-label="Search films by title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <Button
          className={styles.filtersToggle}
          aria-expanded={filtersOpen}
          aria-controls="library-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </Button>

        <div id="library-filters" className={cx(styles.filters, filtersOpen && styles.filtersOpen)}>
          <Select aria-label="Sort films" value={sort} onChange={(e) => setSort(e.target.value)}>
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

          {FILM_CREDITS.map(({ field, label, plural }) => (
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
        <div aria-busy="true" aria-label="Loading films">
          <FilmCardGrid>
            {Array.from({ length: SKELETON_CARDS }, (_, index) => (
              <li key={index}>
                <FilmCardSkeleton />
              </li>
            ))}
          </FilmCardGrid>
        </div>
      ) : filtered.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title="No films match your filters"
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          !err && (
            <EmptyState
              title="No films yet"
              action={
                isAdmin && (
                  <Button as={Link} to="/films/new" variant="primary" size="sm">
                    Add a film
                  </Button>
                )
              }
            >
              {isAdmin
                ? "Add a film to upload its script and start capturing scenes."
                : "Films will appear here once they're added."}
            </EmptyState>
          )
        )
      ) : (
        <FilmCardGrid>
          {filtered.map((film) => (
            <li key={film.id}>
              <FilmCard
                film={film}
                headingLevel={2}
                menu={
                  isAdmin ? (
                    <DropdownMenu
                      label={`Actions for ${film.title}`}
                      triggerVariant="overlay"
                      items={[
                        {
                          key: "edit",
                          label: "Edit details",
                          onSelect: () => nav(`/films/${film.id}/edit`),
                        },
                        {
                          key: "delete",
                          label: deletingId === film.id ? "Deleting…" : "Delete",
                          tone: "danger",
                          disabled: deletingId === film.id,
                          onSelect: () => onDeleteFilm(film),
                        },
                      ]}
                    />
                  ) : undefined
                }
              />
            </li>
          ))}
        </FilmCardGrid>
      )}
    </div>
  );
}
