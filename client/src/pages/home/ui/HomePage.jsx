import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getMovieCoverUrl, getRecentMovies } from "@/entities/movie";
import { api } from "@/shared/api";
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
              <Link className={`${styles.heroButton} ${styles.heroButtonPrimary}`} to="/movies/new">
                Start New Project
              </Link>
              <Link className={`${styles.heroButton} ${styles.heroButtonSecondary}`} to="/movies">
                Browse Projects
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.content} aria-label="Project discovery">
        <div className={styles.recentPanel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Recent Projects</h2>
            <Link className={styles.viewAllLink} to="/movies">
              View All
            </Link>
          </div>

          {err && <p className={styles.error}>{err}</p>}

          {loading ? (
            <div className={styles.emptyState}>
              <p>Loading recent projects...</p>
            </div>
          ) : recentProjects.length === 0 && !err ? (
            <div className={styles.emptyState}>
              <p>No projects yet.</p>
              <Link to="/movies/new">Start your first project</Link>
            </div>
          ) : (
            <div className={styles.projectGrid}>
              {recentProjects.map((movie) => (
                <article className={styles.projectCard} key={movie.id}>
                  <Link className={styles.projectMediaLink} to={`/movies/${movie.id}`}>
                    <div className={styles.projectMedia}>
                      {getMovieCoverUrl(movie) ? (
                        <img
                          alt={`${movie.title} cover`}
                          className={styles.projectImage}
                          loading="lazy"
                          src={getMovieCoverUrl(movie)}
                        />
                      ) : (
                        <div className={styles.projectImageFallback} aria-hidden="true" />
                      )}
                      <div className={styles.projectOverlay}>
                        <h3 className={styles.projectTitle}>{movie.title}</h3>
                        <p className={styles.projectDirector}>{movie.director}</p>
                      </div>
                    </div>
                  </Link>

                  <Link className={styles.projectAction} to={`/movies/${movie.id}`}>
                    Open Project
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>

        <form className={styles.searchBar} onSubmit={submitSearch} role="search">
          <input
            aria-label="Search projects"
            autoComplete="off"
            className={styles.searchInput}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by film, director, writer, or genre..."
            type="search"
            value={query}
          />
          <button className={styles.searchButton} type="submit" aria-label="Search projects">
            <span aria-hidden="true" className={styles.searchIcon} />
          </button>
        </form>
      </section>
    </div>
  );
}
