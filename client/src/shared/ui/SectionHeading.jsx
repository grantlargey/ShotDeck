import { cx } from "@/shared/lib/cx.js";
import styles from "./SectionHeading.module.css";

/**
 * Section title row used on content pages: a small uppercase label (with an
 * optional count or badge) and actions, over a hairline.
 */
export function SectionHeading({ id, title, count, badge, actions, className }) {
  return (
    <div className={cx(styles.header, className)}>
      <h2 id={id} className={styles.title}>
        {title}
        {count !== undefined && <span className={styles.count}>{count}</span>}
        {badge}
      </h2>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
