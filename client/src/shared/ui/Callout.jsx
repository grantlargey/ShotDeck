import { cx } from "@/shared/lib/cx.js";
import styles from "./Callout.module.css";

/**
 * Inline message box with an optional text action.
 *
 * tone: info | success | warning | error | ai
 */
export function Callout({ tone = "info", action, onAction, className, children }) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className={cx(styles.callout, styles[tone], className)}>
      <span>{children}</span>
      {action && (
        <button type="button" className={styles.action} onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
