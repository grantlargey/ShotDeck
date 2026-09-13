import { cx } from "@/shared/lib/cx";
import styles from "./forms.module.css";

/**
 * Text input. With an `icon`, the input is wrapped and `className` goes on the
 * wrapper so layout rules (flex, width) still apply.
 */
export function Input({ icon, className, ...props }) {
  if (!icon) return <input className={cx(styles.control, className)} {...props} />;

  return (
    <span className={cx(styles.withIcon, className)}>
      {icon}
      <input className={styles.control} {...props} />
    </span>
  );
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cx(styles.control, styles.select, className)} {...props}>
      {children}
    </select>
  );
}
