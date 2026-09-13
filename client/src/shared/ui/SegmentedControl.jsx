import { cx } from "@/shared/lib/cx";
import { Badge } from "./Badge.jsx";
import styles from "./SegmentedControl.module.css";

/**
 * Compact option switcher. Defaults to a radio group; with `role="tablist"`
 * each option becomes a tab whose id is `${idPrefix}-${value}` and which
 * controls `panelId`.
 *
 * options: [{ value, label, badge?, disabled?, title? }]
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
  className,
}) {
  const isTabs = role === "tablist";

  return (
    <div role={role} aria-label={label} className={cx(styles.group, block && styles.block, className)}>
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
            className={cx(styles.option, active && styles.active)}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.label}
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
