import { MOVIE_CREDITS } from "@/entities/movie";
import { cx } from "@/shared/lib/cx";
import { formatMinutesToHms } from "@/shared/lib/time";
import { Skeleton } from "@/shared/ui";
import styles from "./MovieDetailPage.module.css";

/**
 * Full-width project hero. A random film still is the backdrop; without one,
 * a blurred copy of the cover stands in. Only credits that are filled in show.
 */
export function MovieHeader({ movie, coverUrl, backdropUrl, actions }) {
  const facts = [
    { label: "Year", value: movie.year },
    { label: "Runtime", value: movie.runtime_minutes ? formatMinutesToHms(movie.runtime_minutes) : "" },
    ...MOVIE_CREDITS.map(({ field, label }) => ({ label, value: movie[field] })),
  ].filter((fact) => fact.value);
  const backdrop = backdropUrl || coverUrl;

  return (
    <section className={styles.hero}>
      {backdrop && (
        <img className={cx(styles.backdrop, !backdropUrl && styles.backdropBlurred)} src={backdrop} alt="" />
      )}

      <div className={styles.heroInner}>
        {coverUrl ? (
          <img className={styles.poster} src={coverUrl} alt={`${movie.title} cover`} />
        ) : (
          <div className={styles.poster} aria-hidden="true" />
        )}

        <div className={styles.heroBody}>
          <p className={styles.eyebrow}>Project</p>
          <h1 className={styles.heroTitle}>{movie.title}</h1>
          {facts.length > 0 && (
            <dl className={styles.facts}>
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {actions && <div className={styles.heroActions}>{actions}</div>}
        </div>
      </div>
    </section>
  );
}

/** Placeholder with the hero's shape, shown while the project loads. */
export function MovieHeaderSkeleton() {
  return (
    <section className={styles.hero} aria-hidden="true">
      <div className={styles.heroInner}>
        <Skeleton className={styles.poster} />
        <div className={styles.heroBody}>
          <Skeleton className={styles.skeletonEyebrow} />
          <Skeleton className={styles.skeletonTitle} />
          <Skeleton className={styles.skeletonFacts} />
        </div>
      </div>
    </section>
  );
}
