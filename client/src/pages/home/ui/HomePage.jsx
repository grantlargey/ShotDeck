import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getRecentFilms } from "@/entities/film/model/filmFilters.js";
import { FilmCard, FilmCardGrid, FilmCardSkeleton } from "@/entities/film/ui/FilmCard.jsx";
import { useSession } from "@/entities/session/model/useSession.js";
import { listFilms } from "@/shared/api/films.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { ChevronRightIcon } from "@/shared/ui/icons.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import { HeroArt } from "./HeroArt.jsx";
import { HeroSceneSearch } from "./HeroSceneSearch.jsx";
import { LibraryReel } from "./LibraryReel.jsx";
import styles from "./HomePage.module.css";

const RECENT_FILM_LIMIT = 5;

export default function HomePage() {
  useDocumentTitle();
  const { isAdmin } = useSession();
  const [films, setFilms] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadFilms() {
      setErr("");
      setLoading(true);
      try {
        const data = await listFilms();
        if (!cancelled) setFilms(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setErr(getErrorMessage(e, "Failed to load recent films."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadFilms();
    return () => {
      cancelled = true;
    };
  }, []);

  const recentFilms = useMemo(() => getRecentFilms(films, RECENT_FILM_LIMIT), [films]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <HeroArt className={styles.heroArt} />
        <div className={styles.heroInner}>
          <div className={styles.heroIntro}>
            <h1 className={styles.heroTitle}>Read between the lines.</h1>
            <p className={styles.heroSubtitle}>
              Analyze scripts, explore shots, and study how great stories are built.
            </p>
          </div>

          <HeroSceneSearch />
        </div>

        <p className={styles.heroCredit}>Spider-Man: Into the Spider-Verse (2018)</p>
      </section>

      <LibraryReel />

      <section className={styles.recent} aria-labelledby="home-recent-heading">
        <SectionHeading
          id="home-recent-heading"
          title="Recently added"
          actions={
            <Button as={Link} to="/library" variant="ghost" size="sm" className={styles.browseLink}>
              Browse the library
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
          <div aria-busy="true" aria-label="Loading recently added films">
            <FilmCardGrid className={styles.recentGrid}>
              {Array.from({ length: RECENT_FILM_LIMIT }, (_, index) => (
                <li key={index}>
                  <FilmCardSkeleton />
                </li>
              ))}
            </FilmCardGrid>
          </div>
        ) : recentFilms.length === 0 ? (
          !err && (
            <EmptyState
              title="No films yet"
              action={
                isAdmin && (
                  <Button as={Link} to="/films/new" variant="primary" size="sm">
                    Add your first film
                  </Button>
                )
              }
            >
              {isAdmin
                ? "Add a film to upload its script and start capturing scenes."
                : "Films will appear here once they're added."}
            </EmptyState>
          )
        ) : (
          <FilmCardGrid className={styles.recentGrid}>
            {recentFilms.map((film) => (
              <li key={film.id}>
                <FilmCard film={film} />
              </li>
            ))}
          </FilmCardGrid>
        )}
      </section>
    </div>
  );
}
