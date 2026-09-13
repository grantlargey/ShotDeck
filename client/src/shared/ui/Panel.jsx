import { cx } from "@/shared/lib/cx";
import styles from "./Panel.module.css";

/** Bordered content section with an optional title row. */
export function Panel({ title, actions, className, children, ...props }) {
  return (
    <section className={cx(styles.panel, className)} {...props}>
      {(title || actions) && (
        <div className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
