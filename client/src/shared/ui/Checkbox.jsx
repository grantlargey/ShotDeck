import { cx } from "@/shared/lib/cx.js";
import styles from "./Checkbox.module.css";

export function Checkbox({ className, ...props }) {
  return <input type="checkbox" className={cx(styles.checkbox, className)} {...props} />;
}
