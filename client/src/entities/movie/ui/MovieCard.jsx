import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { cx } from "@/shared/lib/cx.js";
import { canAnimatePageChange } from "@/shared/lib/viewTransition.js";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import { openProjectWithPosterTransition, posterTransitionState } from "../model/posterTransition.js";
import styles from "./MovieCard.module.css";

/**
 * Poster card for a project, shared by the home page and My Projects. `menu`
 * sits over the poster's top-right corner, outside the card link, so its
 * buttons never trigger navigation.
 */
export function MovieCard({ movie, menu, headingLevel = 3 }) {
  const coverUrl = useSignedMediaUrl(movie.cover_image_key, movie.cover_image_url) || "";
  const [failedUrl, setFailedUrl] = useState("");
  const showCover = Boolean(coverUrl) && failedUrl !== coverUrl;
  const Heading = `h${headingLevel}`;
  const navigate = useNavigate();
  const imageRef = useRef(null);
  const to = `/movies/${movie.id}`;

  // A plain click on a loaded poster opens the project with the poster gliding
  // into place; new-tab clicks and browsers without view transitions navigate as usual.
  function openWithPosterTransition(event) {
    const image = imageRef.current;
    const plainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!plainClick || !image?.complete || !canAnimatePageChange()) return;
    event.preventDefault();
    openProjectWithPosterTransition(navigate, to, image, posterTransitionState(coverUrl, movie.cover_image_key));
  }

  return (
    <article className={styles.card}>
      <Link className={styles.link} to={to} onClick={openWithPosterTransition}>
        <div className={styles.poster}>
          {showCover ? (
            <img
              ref={imageRef}
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
