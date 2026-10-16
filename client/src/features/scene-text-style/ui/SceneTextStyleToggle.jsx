import { useEffect, useState } from "react";
import { cx } from "@/shared/lib/cx.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { nextSceneTextStyle, sceneTextStyleLabel, useSceneTextStyle } from "../model/sceneTextStyle.js";
import { ScenePage } from "./ScenePage.jsx";
import styles from "./SceneTextStyleToggle.module.css";

// How tall the page stands: as tall as the logo mark it replaces, or sized to
// sit among a tool bar's 36px switches.
const PAGE_HEIGHTS = { logo: { md: 26, sm: 20 }, toolbar: { md: 20, sm: 20 } };
// How long a turn plays: the shuffle, the typing, then the carriage return
// (SceneTextStyleToggle.module.css).
const TURN_MS = 1120;

/**
 * One button for the scene text style: a small screenplay page in the
 * visitor's current style. Hovering fans the other two styles' pages out
 * behind it, one each side. A click turns to the next style, white, cream,
 * then blue: this page slips back, the next comes forward from where it
 * fanned, its scene is typed line by line, and the carriage returns. With
 * reduced motion the page just changes.
 *
 * The same toggle sits in the logo (with the wordmark beside it as the link
 * home) and in the tool bars that show scene text.
 *
 * look: "logo" stands bare; "toolbar" sits in a tile shaped like the switches
 * beside it.
 * size: sm | md, for the logo, as BrandLogo.
 * disabled: shown but not usable, as while the scene dialog shows a still.
 */
export function SceneTextStyleToggle({ look = "logo", size = "md", disabled = false, className }) {
  const [style, setStyle] = useSceneTextStyle();
  const reducedMotion = usePrefersReducedMotion();
  // The turn playing now, if any: the page it took away, and a fresh id so a
  // click mid-turn starts the animation over.
  const [turn, setTurn] = useState(null);
  const next = nextSceneTextStyle(style);
  const height = PAGE_HEIGHTS[look][size];

  useEffect(() => {
    if (!turn) return undefined;
    const timer = setTimeout(() => setTurn(null), TURN_MS);
    return () => clearTimeout(timer);
  }, [turn]);

  function turnPage() {
    if (!reducedMotion) setTurn((current) => ({ id: (current?.id ?? 0) + 1, from: style }));
    setStyle(next);
  }

  return (
    <button
      type="button"
      className={cx(styles.toggle, styles[look], className)}
      aria-label={`Page style: ${sceneTextStyleLabel(style)}. Turn to ${sceneTextStyleLabel(next)}`}
      title="Change page style"
      disabled={disabled}
      onClick={turnPage}
    >
      {/* --u is a pixel at the logo's full 26px, so every offset scales with the page. */}
      <span className={styles.stack} style={{ "--u": `${height / 26}px`, width: (height * 20) / 26, height }}>
        {turn ? (
          <span key={`leaving-${turn.id}`} className={cx(styles.layer, styles.leaving)}>
            <ScenePage pageStyle={turn.from} height={height} />
          </span>
        ) : (
          <>
            <span className={cx(styles.layer, styles.after)}>
              <ScenePage pageStyle={nextSceneTextStyle(next)} height={height} />
            </span>
            <span className={cx(styles.layer, styles.next)}>
              <ScenePage pageStyle={next} height={height} />
            </span>
          </>
        )}
        <span key={`current-${turn?.id ?? "rest"}`} className={cx(styles.layer, turn && styles.arriving)}>
          <ScenePage height={height} typing={Boolean(turn)} />
        </span>
      </span>
    </button>
  );
}
