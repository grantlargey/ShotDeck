import { useState } from "react";
import { Link } from "react-router-dom";
import { cx } from "@/shared/lib/cx.js";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import styles from "./MovieCard.module.css";

/**
 * Poster card for a project, shared by the home page and My Projects. `menu`
 * sits over the poster's top-right corner, outside the card link, so its
 * buttons never trigger navigation.
 */
export function MovieCard({ movie, menu, headingLevel = 3 }) {
  const coverUrl = movie.cover_image_url || "";
  const [failedUrl, setFailedUrl] = useState("");
  const showCover = Boolean(coverUrl) && failedUrl !== coverUrl;
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
          {(movie.director || movie.year) && (
            <p className={styles.details}>
              {movie.director && <span className={styles.director}>{movie.director}</span>}
              {movie.director && movie.year && <span aria-hidden="true">·</span>}
              {movie.year && <span className={styles.year}>{movie.year}</span>}
            </p>
          )}
        </div>
      </Link>
      {menu && <div className={styles.menu}>{menu}</div>}
    </article>
  );
}

/** Placeholder with the card's shape, shown while projects load. */
export function MovieCardSkeleton() {
  return (
    <div className={cx(styles.card, styles.skeletonCard)} aria-hidden="true">
      <Skeleton className={styles.skeletonPoster} />
      <div className={styles.meta}>
        <Skeleton className={styles.skeletonTitle} />
        <Skeleton className={styles.skeletonDetails} />
      </div>
    </div>
  );
}

export function MovieCardGrid({ className, children }) {
  return <ul className={cx(styles.grid, className)}>{children}</ul>;
}
