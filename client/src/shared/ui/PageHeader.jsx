import { cx } from "@/shared/lib/cx.js";
import styles from "./PageHeader.module.css";

/** Page title block: optional eyebrow, the page's h1, a description, and actions. */
export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.text}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
