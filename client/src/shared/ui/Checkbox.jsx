import { cx } from "@/shared/lib/cx.js";
import styles from "./Checkbox.module.css";

/**
 * look: "box", a filled square; or "typed", [ ] and [x] set in Slate, the x
 * struck in the Midnight blue.
 */
export function Checkbox({ look = "box", className, ...props }) {
  if (look === "typed") {
    return (
      <span className={cx(styles.typed, className)}>
        <input type="checkbox" className={styles.typedInput} {...props} />
        <span className={styles.typedMark} aria-hidden="true">
          [<span className={styles.typedX}>x</span>]
        </span>
      </span>
    );
  }
  return <input type="checkbox" className={cx(styles.checkbox, className)} {...props} />;
}
