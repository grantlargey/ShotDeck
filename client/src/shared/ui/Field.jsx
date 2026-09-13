import { cx } from "@/shared/lib/cx";
import styles from "./forms.module.css";

/**
 * Label, control, and optional hint. Renders a <label> so one nested input is
 * labelled implicitly; use `as="div"` around composite controls like FileInput.
 */
export function Field({ as = "label", label, hint, className, children }) {
  const Tag = as;
  return (
    <Tag className={cx(styles.field, className)}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </Tag>
  );
}
