import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getRecentMovies, MovieCard, MovieCardGrid } from "@/entities/movie";
import { api } from "@/shared/api";
import {
  Button,
  Callout,
  ChevronRightIcon,
  EmptyState,
  Input,
  LoadingState,
  Panel,
  SearchIcon,
} from "@/shared/ui";
import styles from "./HomePage.module.css";

export default function HomePage() {
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
        if (!cancelled) setErr(e.message || "Failed to load recent projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMovies();
    return () => {
      cancelled = true;
    };
  }, []);

  const recentProjects = useMemo(() => getRecentMovies(movies, 3), [movies]);

  function submitSearch(event) {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/movies?query=${encodeURIComponent(trimmed)}` : "/movies");
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroContent}>
            <h1 className={styles.heroTitle}>Read Between The Lines.</h1>
            <p className={styles.heroSubtitle}>
              Analyze scripts, annotate scenes, and experience storytelling patterns
            </p>
            <div className={styles.heroActions}>
              <Button as={Link} to="/movies/new" variant="primary" size="lg" className={styles.heroButton}>
                Start New Project
              </Button>
              <Button as={Link} to="/movies" size="lg" className={`${styles.heroButton} ${styles.heroButtonGlass}`}>
                Browse Projects
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.content} aria-label="Project discovery">
        <Panel
          title="Recent projects"
          className={styles.recentPanel}
          actions={
            <Button as={Link} to="/movies" variant="link" size="sm">
              View all
              <ChevronRightIcon size={14} />
            </Button>
          }
        >
          {err && (
            <Callout tone="error" className={styles.notice}>
              {err}
            </Callout>
          )}

          {loading ? (
            <LoadingState>Loading recent projects…</LoadingState>
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
            <MovieCardGrid>
              {recentProjects.map((movie) => (
                <li key={movie.id}>
                  <MovieCard movie={movie} />
                </li>
              ))}
            </MovieCardGrid>
          )}
        </Panel>

        <form className={styles.searchBar} onSubmit={submitSearch} role="search">
          <Input
            icon={<SearchIcon />}
            className={styles.searchField}
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
      </section>
    </div>
  );
}
