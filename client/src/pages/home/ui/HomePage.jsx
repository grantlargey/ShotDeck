import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRecentMovies, MovieCard, MovieCardGrid, MovieCardSkeleton } from "@/entities/movie";
import { api } from "@/shared/api";
import { useDocumentTitle } from "@/shared/lib/document-title";
import { getErrorMessage } from "@/shared/lib/errors";
import {
  Button,
  Callout,
  ChevronRightIcon,
  EmptyState,
  Input,
  SearchIcon,
  SectionHeading,
} from "@/shared/ui";
import { SiteFooter } from "@/widgets/site-footer";
import styles from "./HomePage.module.css";

const RECENT_PROJECT_LIMIT = 5;

export default function HomePage() {
  useDocumentTitle();
  const navigate = useNavigate();
  const [movies, setMovies] = useState([]);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadMovies() {
      setErr("");
      setLoading(true);
      try {
        const data = await api.listMovies();
        if (!cancelled) setMovies(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setErr(getErrorMessage(e, "Failed to load recent projects."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMovies();
    return () => {
      cancelled = true;
    };
  }, []);

  const recentProjects = useMemo(() => getRecentMovies(movies, RECENT_PROJECT_LIMIT), [movies]);

  function submitSearch(event) {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/movies?query=${encodeURIComponent(trimmed)}` : "/movies");
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroIntro}>
            <h1 className={styles.heroTitle}>Read between the lines.</h1>
            <p className={styles.heroSubtitle}>
              Analyze scripts, annotate scenes, and study how great stories are built.
            </p>
          </div>

          <div className={styles.heroActions}>
            <form className={styles.heroSearch} onSubmit={submitSearch} role="search">
              <Input
                icon={<SearchIcon size={18} />}
                className={styles.heroSearchField}
                aria-label="Search projects"
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects by title…"
                type="search"
                value={query}
              />
              <Button type="submit" variant="primary">
                Search
              </Button>
            </form>
            <Button as={Link} to="/movies" variant="ghost" size="sm" className={styles.browseLink}>
              Browse all projects
              <ChevronRightIcon size={14} />
            </Button>
          </div>
        </div>

        <p className={styles.heroCredit}>Spider-Man: Into the Spider-Verse (2018)</p>
      </section>

      <section className={styles.recent} aria-labelledby="home-recent-heading">
        <SectionHeading
          id="home-recent-heading"
          title="Recent projects"
          actions={
            <Button as={Link} to="/movies" variant="link" size="sm">
              View all
              <ChevronRightIcon size={14} />
            </Button>
          }
        />

        {err && (
          <Callout tone="error" className={styles.notice}>
            {err}
          </Callout>
        )}

        {loading ? (
          <div aria-busy="true" aria-label="Loading recent projects">
            <MovieCardGrid className={styles.recentGrid}>
              {Array.from({ length: RECENT_PROJECT_LIMIT }, (_, index) => (
                <li key={index}>
                  <MovieCardSkeleton />
                </li>
              ))}
            </MovieCardGrid>
          </div>
        ) : recentProjects.length === 0 ? (
          !err && (
            <EmptyState
              title="No projects yet"
              action={
                <Button as={Link} to="/movies/new" variant="primary" size="sm">
                  Start your first project
                </Button>
              }
            >
              Create a project to upload a script and start annotating scenes.
            </EmptyState>
          )
        ) : (
          <MovieCardGrid className={styles.recentGrid}>
            {recentProjects.map((movie) => (
              <li key={movie.id}>
                <MovieCard movie={movie} />
              </li>
            ))}
          </MovieCardGrid>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
