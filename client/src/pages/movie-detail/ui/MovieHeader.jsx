import { formatMinutesToHms } from "@/shared/lib/time";
import { PageHeader } from "@/shared/ui";
import styles from "./MovieDetailPage.module.css";

export function MovieHeader({ movie, coverUrl, actions }) {
  return (
    <div className={styles.header}>
      {coverUrl ? (
        <img className={styles.poster} src={coverUrl} alt={`${movie.title} cover`} />
      ) : (
        <div className={styles.poster} aria-hidden="true" />
      )}

      <div className={styles.headerBody}>
        <PageHeader eyebrow="Project" title={movie.title} actions={actions} className={styles.pageHeader} />
        <dl className={styles.facts}>
          <div>
            <dt>Year</dt>
            <dd>{movie.year || "—"}</dd>
          </div>
          <div>
            <dt>Director</dt>
            <dd>{movie.director || "—"}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{formatMinutesToHms(movie.runtime_minutes)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
