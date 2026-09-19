import { cx } from "@/shared/lib/cx.js";
import styles from "./forms.module.css";

/**
 * Label, control, and optional hint. Renders a <label> so one nested input is
 * labelled implicitly; use `as="div"` around composite controls like FileInput.
 * `required` only adds the visual marker; the control still needs `required`.
 */
export function Field({ as = "label", label, hint, required = false, className, children }) {
  const Tag = as;
  return (
    <Tag className={cx(styles.field, className)}>
      <span className={styles.label}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </Tag>
  );
}
