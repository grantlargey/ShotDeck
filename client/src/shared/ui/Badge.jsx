import { cx } from "@/shared/lib/cx.js";
import styles from "./Badge.module.css";

/**
 * Small pill for counts, statuses, and tags.
 *
 * tone: neutral | accent | success | warning | danger | ai
 * solid: filled accent style, used for counts on controls
 */
export function Badge({ tone = "neutral", solid = false, className, children }) {
  return <span className={cx(styles.badge, styles[tone], solid && styles.solid, className)}>{children}</span>;
}
