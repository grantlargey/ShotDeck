import { cx } from "@/shared/lib/cx";
import styles from "./LoadingState.module.css";

export function LoadingState({ children = "Loading…", className }) {
  return (
    <p className={cx(styles.loading, className)} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {children}
    </p>
  );
}
