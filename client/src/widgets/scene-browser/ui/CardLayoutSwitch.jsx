import { useState } from "react";
import { cx } from "@/shared/lib/cx.js";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import styles from "./CardLayoutSwitch.module.css";

const LAYOUTS = [
  { value: "script", label: "Script only" },
  { value: "split", label: "Film still and script" },
];

/**
 * A little scene card in one layout, in the visitor's page style: script only,
 * or a still over the script. `stillUrl` puts a real still in it; a dark
 * frame stands in without one. `alive` plays it in: the still develops like a
 * print, or the script is typed.
 */
function LayoutCard({ layout, stillUrl, alive }) {
  const split = layout === "split";
  return (
    <span className={cx(styles.card, split && styles.split, alive && styles.alive)} aria-hidden="true">
      {split && <span className={styles.still} style={stillUrl ? { backgroundImage: `url("${stillUrl}")` } : undefined} />}
      <span className={styles.paper}>
        <i className={styles.heading} />
        <i className={styles.action} />
        <i className={styles.actionEnd} />
        <i className={styles.cue} />
        <i className={styles.dialogue} />
      </span>
      <span className={styles.meta}>
        <i className={styles.title} />
      </span>
    </span>
  );
}

/**
 * The scene browser's card preview switch: two little cards, script only and a
 * still over the script, both in sight. The chosen card sits forward and
 * comes alive each time it's picked.
 */
export function CardLayoutSwitch({ value, onChange, stillUrl }) {
  // Counts picks, so the chosen card plays in again each time.
  const [picks, setPicks] = useState(0);
  const options = LAYOUTS.map((layout) => ({
    value: layout.value,
    label: layout.label,
    title: layout.label,
    hideLabel: true,
    icon: (
      <LayoutCard
        key={`${layout.value}-${picks}`}
        layout={layout.value}
        stillUrl={stillUrl}
        alive={picks > 0 && value === layout.value}
      />
    ),
  }));

  return (
    <SegmentedControl
      label="Card preview"
      options={options}
      value={value}
      onChange={(next) => {
        setPicks((count) => count + 1);
        onChange(next);
      }}
    />
  );
}
