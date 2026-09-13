import { getTimelinePositionPercent } from "@/entities/annotation";
import { cx } from "@/shared/lib/cx";
import { formatSecondsToHms } from "@/shared/lib/time";
import styles from "./AnnotationTimeline.module.css";

export function AnnotationTimeline({ annotations, onSelect, runtimeSeconds, selectedIndex }) {
  return (
    <div className={styles.timeline}>
      <div className={styles.track}>
        {annotations.map((annotation, idx) => {
          const pct = getTimelinePositionPercent(annotation, runtimeSeconds);
          const time = formatSecondsToHms(annotation.time_seconds);

          return (
            <button
              key={annotation.id}
              type="button"
              className={cx(styles.marker, idx === selectedIndex && styles.markerActive)}
              style={{ left: `${pct}%` }}
              title={time}
              aria-label={`Annotation at ${time}`}
              aria-pressed={idx === selectedIndex}
              onClick={() => onSelect(idx)}
            />
          );
        })}
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span>00:00:00</span>
        <span>{formatSecondsToHms(runtimeSeconds)}</span>
      </div>
    </div>
  );
}
