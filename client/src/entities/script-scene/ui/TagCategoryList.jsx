import { useState } from "react";
import { cx } from "@/shared/lib/cx.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { Checkbox } from "@/shared/ui/Checkbox.jsx";
import { ChevronDownIcon } from "@/shared/ui/icons.jsx";
import styles from "./TagCategoryList.module.css";

/**
 * Collapsible tag categories with a checkbox per tag, shared by the script
 * search filters and the annotator's Tags tab.
 *
 * - `counts` (Map of tag → scene count) shows per-tag totals and dims empty tags.
 * - `openGroups` / `onToggleGroup` keep the expanded state in the parent, so it
 *   survives the list unmounting (e.g. when switching tabs).
 */
export function TagCategoryList({
  groups,
  selectedTags,
  onToggleTag,
  counts,
  idPrefix,
  openGroups,
  onToggleGroup,
  className,
}) {
  const [localOpenGroups, setLocalOpenGroups] = useState(() => new Set());
  const expanded = openGroups ?? localOpenGroups;

  function toggleGroup(key) {
    if (onToggleGroup) {
      onToggleGroup(key);
      return;
    }
    setLocalOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <ul className={cx(styles.list, className)}>
      {groups.map((group) => {
        const isOpen = expanded.has(group.key);
        const selectedCount = group.tags.filter((tag) => selectedTags.includes(tag.value)).length;
        const panelId = `${idPrefix}-${group.key}`;

        return (
          <li key={group.key} className={styles.category}>
            <button
              type="button"
              className={cx(styles.toggle, isOpen && styles.toggleOpen)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggleGroup(group.key)}
            >
              <span className={styles.label}>{group.label}</span>
              {selectedCount > 0 && (
                <Badge tone="accent" solid>
                  {selectedCount}
                </Badge>
              )}
              <ChevronDownIcon className={styles.chevron} size={12} />
            </button>

            {isOpen && (
              <ul id={panelId} className={styles.options}>
                {group.tags.map((tag) => {
                  const checked = selectedTags.includes(tag.value);
                  const count = counts ? counts.get(tag.value) || 0 : null;

                  return (
                    <li key={tag.value}>
                      <label className={cx(styles.option, count === 0 && !checked && styles.optionEmpty)}>
                        <Checkbox checked={checked} onChange={() => onToggleTag(tag.value)} />
                        <span>{tag.label}</span>
                        {count !== null && <span className={styles.count}>({count.toLocaleString()})</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
