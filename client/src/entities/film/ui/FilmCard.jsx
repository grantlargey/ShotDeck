import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { cx } from "@/shared/lib/cx.js";
import { canAnimatePageChange } from "@/shared/lib/viewTransition.js";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import { openFilmWithPosterTransition, posterTransitionState } from "../model/posterTransition.js";
import styles from "./FilmCard.module.css";

/**
 * Poster card for a film, shared by the home page and the library. `menu`
 * sits over the poster's top-right corner, outside the card link, so its
 * buttons never trigger navigation.
 */
export function FilmCard({ film, menu, headingLevel = 3 }) {
  const coverUrl = useSignedMediaUrl(film.cover_image_key, film.cover_image_url) || "";
  const [failedUrl, setFailedUrl] = useState("");
  const showCover = Boolean(coverUrl) && failedUrl !== coverUrl;
  const Heading = `h${headingLevel}`;
  const navigate = useNavigate();
  const imageRef = useRef(null);
  const to = `/films/${film.id}`;

  // A plain click on a loaded poster opens the film with the poster gliding
  // into place; new-tab clicks and browsers without view transitions navigate as usual.
  function openWithPosterTransition(event) {
    const image = imageRef.current;
    const plainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!plainClick || !image?.complete || !canAnimatePageChange()) return;
    event.preventDefault();
    openFilmWithPosterTransition(navigate, to, image, posterTransitionState(coverUrl, film.cover_image_key));
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
              {String(film.title || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className={styles.meta}>
          <Heading className={styles.title}>{film.title}</Heading>
          {(film.director || film.year) && (
            <p className={styles.details}>
              {film.director && <span className={styles.director}>{film.director}</span>}
              {film.director && film.year && <span aria-hidden="true">·</span>}
              {film.year && <span className={styles.year}>{film.year}</span>}
            </p>
          )}
        </div>
      </Link>
      {menu && <div className={styles.menu}>{menu}</div>}
    </article>
  );
}

/** Placeholder with the card's shape, shown while films load. */
export function FilmCardSkeleton() {
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

export function FilmCardGrid({ className, children }) {
  return <ul className={cx(styles.grid, className)}>{children}</ul>;
}
