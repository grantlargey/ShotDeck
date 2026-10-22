import { cx } from "@/shared/lib/cx.js";
import styles from "./forms.module.css";

/**
 * Text input. With an `icon`, the input is wrapped and `className` goes on the
 * wrapper so layout rules (flex, width) still apply. `numeric` is for a field
 * that takes a number or a timecode, set in Slate like every timecode and count.
 */
export function Input({ icon, numeric = false, className, ...props }) {
  const controlClass = cx(styles.control, numeric && styles.numeric);
  if (!icon) return <input className={cx(controlClass, className)} {...props} />;

  return (
    <span className={cx(styles.withIcon, className)}>
      {icon}
      <input className={controlClass} {...props} />
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
