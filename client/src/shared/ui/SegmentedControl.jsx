import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/shared/lib/cx.js";
import { Badge } from "./Badge.jsx";
import styles from "./SegmentedControl.module.css";

/**
 * Where the chosen option sits in the group, measured whenever the choice or
 * the group's size changes, so a highlight can glide there.
 */
function useChosenOptionBox(groupRef, enabled, value) {
  const [box, setBox] = useState(null);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!enabled || !group) return undefined;
    const measure = () => {
      const chosen = group.querySelector('[aria-checked="true"], [aria-selected="true"]');
      const next = chosen ? { left: chosen.offsetLeft, width: chosen.offsetWidth } : null;
      setBox((current) =>
        current && next && current.left === next.left && current.width === next.width ? current : next
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [groupRef, enabled, value]);

  return box;
}

/**
 * Compact option switcher. Defaults to a radio group; with `role="tablist"`
 * each option becomes a tab whose id is `${idPrefix}-${value}` and which
 * controls `panelId`.
 *
 * options: [{ value, label, icon?, hideLabel?, badge?, disabled?, title? }]
 * `hideLabel` shows only the icon; the label stays as the accessible name.
 * `sliding` draws the chosen option's highlight as one piece that glides
 * between options instead of jumping.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  label,
  role = "radiogroup",
  idPrefix,
  panelId,
  block = false,
  sliding = false,
  className,
}) {
  const isTabs = role === "tablist";
  const groupRef = useRef(null);
  const highlight = useChosenOptionBox(groupRef, sliding, value);

  return (
    <div
      ref={groupRef}
      role={role}
      aria-label={label}
      className={cx(styles.group, block && styles.block, sliding && styles.sliding, className)}
    >
      {sliding && highlight && (
        <span
          className={styles.highlight}
          style={{ width: highlight.width, transform: `translateX(${highlight.left}px)` }}
          aria-hidden="true"
        />
      )}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={isTabs ? "tab" : "radio"}
            id={isTabs && idPrefix ? `${idPrefix}-${option.value}` : undefined}
            aria-selected={isTabs ? active : undefined}
            aria-checked={isTabs ? undefined : active}
            aria-controls={isTabs ? panelId : undefined}
            className={cx(styles.option, active && styles.active, option.hideLabel && styles.iconOnly)}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.hideLabel ? <span className={styles.srOnly}>{option.label}</span> : option.label}
            {option.badge ? (
              <Badge tone="accent" solid>
                {option.badge}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
