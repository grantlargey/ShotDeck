import { cx } from "@/shared/lib/cx.js";
import styles from "./BrandLogo.module.css";

/**
 * ScriptDeck logo: a script page with a folded corner beside the wordmark.
 *
 * size: sm | md
 * showWordmark: false leaves just the mark, for tight bars (label the link instead)
 */
export function BrandLogo({ size = "md", showWordmark = true, className }) {
  return (
    <span className={cx(styles.logo, styles[size], className)}>
      <svg className={styles.mark} viewBox="0 0 22 26" aria-hidden="true" focusable="false">
        <path className={styles.page} d="M3 1h11l6 6v17a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" />
        <path className={styles.fold} d="M14 1v5a1 1 0 0 0 1 1h5Z" />
        {/* A character cue over two lines of dialogue. */}
        <path className={styles.lines} d="M8.5 12.5h5M5.5 16h11M5.5 19.5h8" />
      </svg>
      {showWordmark && (
        <span className={styles.wordmark}>
          <span className={styles.strong}>Script</span>Deck
        </span>
      )}
    </span>
  );
}
