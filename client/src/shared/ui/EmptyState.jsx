import { cx } from "@/shared/lib/cx";
import styles from "./EmptyState.module.css";

export function EmptyState({ title, children, action, compact = false, className }) {
  return (
    <div className={cx(styles.empty, compact && styles.compact, className)}>
      {title && <p className={styles.title}>{title}</p>}
      {children && <p className={styles.description}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
