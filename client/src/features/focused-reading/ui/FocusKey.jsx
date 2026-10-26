import { useId } from "react";
import { cx } from "@/shared/lib/cx.js";
import styles from "./FocusKey.module.css";

// The iris's six blades, each from a corner of the opening out past the ring, which clips them.
const BLADES = [
  "M9.54 5.33L16.43 17.26",
  "M6.46 5.33L20.23 5.33",
  "M4.92 8L11.81 -3.93",
  "M6.46 10.67L-0.43 -1.26",
  "M9.54 10.67L-4.23 10.67",
  "M11.08 8L4.19 19.93",
];

/** A camera's iris: it turns as it's pointed at and closes down while focus is on. */
function ApertureIcon() {
  const clipId = useId();
  return (
    <svg
      className={styles.icon}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="8" cy="8" r="6.4" />
        </clipPath>
      </defs>
      <circle cx="8" cy="8" r="6.4" />
      <g clipPath={`url(#${clipId})`}>
        <g className={styles.blades}>
          {BLADES.map((d) => (
            <path key={d} d={d} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      </g>
    </svg>
  );
}

/**
 * The focused reading key: an iris and FOCUS in Slate, sized to end a meta
 * line ("Script · 104 pages · FOCUS"). Pressed, focus comes on: the iris
 * closes down in the Mark blue and the key leaves its line for a set spot at
 * the screen's top-left corner, clear of the text. There it rests dimmed, its
 * word folded away, until it's pointed at or tabbed to. The surface showing it
 * glides it between the two (focusMotion.js) and listens for F and Esc
 * (useFocusKeys.js).
 *
 * on: focus is on, and the key is docked in its corner.
 * disabled: shown but not usable, as while the scene dialog shows a still.
 */
export function FocusKey({ ref, on, disabled = false, onToggle, className }) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(styles.key, on && styles.on, className)}
      aria-pressed={on}
      aria-keyshortcuts="F"
      title={on ? "Leave focus (Esc)" : "Focus (F)"}
      disabled={disabled}
      onClick={() => onToggle(!on)}
    >
      <ApertureIcon />
      <span className={styles.word}>Focus</span>
    </button>
  );
}
