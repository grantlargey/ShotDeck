import { cx } from "@/shared/lib/cx.js";
import styles from "./Skeleton.module.css";

/** Shimmering placeholder block; size it with a className. Hidden from assistive tech. */
export function Skeleton({ className }) {
  return <span className={cx(styles.skeleton, className)} aria-hidden="true" />;
}
