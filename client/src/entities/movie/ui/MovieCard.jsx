import { useState } from "react";
import { Link } from "react-router-dom";
import { cx } from "@/shared/lib/cx";
import { getMovieCoverUrl } from "../model/movieFilters.js";
import styles from "./MovieCard.module.css";

/**
 * Poster card for a project, shared by the home page and My Projects. `menu`
 * sits over the poster's top-right corner, outside the card link, so its
 * buttons never trigger navigation.
 */
export function MovieCard({ movie, menu, headingLevel = 3 }) {
  const coverUrl = getMovieCoverUrl(movie);
  const [failedUrl, setFailedUrl] = useState("");
  const showCover = Boolean(coverUrl) && failedUrl !== coverUrl;
  const details = [movie.director, movie.year].filter(Boolean).join(" · ");
  const Heading = `h${headingLevel}`;

  return (
    <article className={styles.card}>
      <Link className={styles.link} to={`/movies/${movie.id}`}>
        <div className={styles.poster}>
          {showCover ? (
            <img
              className={styles.image}
              src={coverUrl}
              alt=""
              loading="lazy"
              onError={() => setFailedUrl(coverUrl)}
            />
          ) : (
            <span className={styles.fallback} aria-hidden="true">
              {String(movie.title || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className={styles.meta}>
          <Heading className={styles.title}>{movie.title}</Heading>
          {details && <p className={styles.details}>{details}</p>}
        </div>
      </Link>
      {menu && <div className={styles.menu}>{menu}</div>}
    </article>
  );
}

export function MovieCardGrid({ className, children }) {
  return <ul className={cx(styles.grid, className)}>{children}</ul>;
}
