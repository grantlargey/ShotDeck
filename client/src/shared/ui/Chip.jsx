import { cx } from "@/shared/lib/cx.js";
import styles from "./Chip.module.css";

/** Removable selection chip, e.g. an active filter or an applied tag. */
export function Chip({ onRemove, removeLabel, className, children }) {
  return (
    <button type="button" className={cx(styles.chip, className)} onClick={onRemove} aria-label={removeLabel}>
      {children}
      <span className={styles.remove} aria-hidden="true">
        ×
      </span>
    </button>
  );
}
