import { cx } from "@/shared/lib/cx.js";
import styles from "./ScenePage.module.css";

/**
 * A small screenplay page in a scene text style's paper and inks: a heading,
 * two lines of action, then a cue over two lines of dialogue. It shows the
 * visitor's current style unless `pageStyle` names another, which its
 * `data-scene-text-style` then applies to it alone.
 *
 * Each line is its own stroke, in reading order, with a path length of 1, so
 * the page can be typed line by line.
 *
 * height: in pixels; the page keeps a sheet's proportions.
 * typing: types the lines in as the page appears; --type-start delays it.
 */
export function ScenePage({ pageStyle, height = 26, typing = false, className }) {
  return (
    <svg
      className={cx(styles.page, typing && styles.typing, className)}
      data-scene-text-style={pageStyle}
      viewBox="0 0 20 26"
      width={(height * 20) / 26}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <rect className={styles.paper} x="0.75" y="0.75" width="18.5" height="24.5" rx="2.25" />
      <path className={styles.heading} d="M4 5h8.5" pathLength="1" />
      <path className={styles.line} d="M4 9.25h12" pathLength="1" />
      <path className={styles.line} d="M4 12h8.5" pathLength="1" />
      <path className={styles.cue} d="M8.25 15.75h4" pathLength="1" />
      <path className={styles.line} d="M5.75 19h8.5" pathLength="1" />
      <path className={styles.line} d="M5.75 21.5h6" pathLength="1" />
    </svg>
  );
}
