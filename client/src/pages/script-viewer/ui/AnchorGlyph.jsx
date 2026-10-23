import { cx } from "@/shared/lib/cx.js";
import { ANCHOR_KEYS } from "../model/anchorNames.js";
import styles from "./AnchorGlyph.module.css";

/**
 * An anchor's mark, the bracket that also sets it: [ for Begin, ] for End,
 * on a faint tile. `empty` draws an anchor that isn't placed yet.
 */
export function AnchorGlyph({ kind, empty = false, className }) {
  return (
    <span className={cx(styles.glyph, empty && styles.empty, className)} aria-hidden="true">
      {ANCHOR_KEYS[kind]}
    </span>
  );
}
