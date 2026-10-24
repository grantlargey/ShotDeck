import { cx } from "@/shared/lib/cx.js";
import styles from "./SectionHeading.module.css";

/**
 * Section title row used on content pages: a small uppercase label (with an
 * optional count or badge) and actions, over a hairline.
 */
export function SectionHeading({ id, title, count, badge, description, actions, className, actionsClassName }) {
  return (
    <div className={cx(styles.header, className)}>
      <div className={styles.heading}>
        <h2 id={id} className={styles.title}>
          {title}
          {count !== undefined && <span className={styles.count}>{count}</span>}
          {badge}
        </h2>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={cx(styles.actions, actionsClassName)}>{actions}</div>}
    </div>
  );
}
