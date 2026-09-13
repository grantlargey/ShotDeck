import { cx } from "@/shared/lib/cx";
import styles from "./SectionHeading.module.css";

/**
 * Section title row used on content pages: a small uppercase label (with an
 * optional count or badge) and actions, over a hairline.
 */
export function SectionHeading({ as = "h2", id, title, count, badge, actions, className }) {
  const Tag = as;
  return (
    <div className={cx(styles.header, className)}>
      <Tag id={id} className={styles.title}>
        {title}
        {count !== undefined && <span className={styles.count}>{count}</span>}
        {badge}
      </Tag>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
