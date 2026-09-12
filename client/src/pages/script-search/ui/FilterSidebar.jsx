import { useState } from "react";
import styles from "./ScriptSearchPage.module.css";

const MATCH_OPTIONS = [
  { value: "all", label: "Match all" },
  { value: "any", label: "Match any" },
];

export default function FilterSidebar({
  groups,
  tagCounts,
  selectedTags,
  match,
  open,
  onClose,
  onToggleTag,
  onMatchChange,
  onClear,
}) {
  const [openGroups, setOpenGroups] = useState(() => new Set());

  function toggleGroup(key) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      {open && <div className={styles.sidebarBackdrop} onClick={onClose} aria-hidden="true" />}

      <aside
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}
        aria-label="Scene filters"
      >
        <div className={styles.sidebarTop}>
          <label className={styles.searchField}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              disabled
              placeholder="Search scenes (coming soon)"
              aria-label="Search scenes (coming soon)"
            />
          </label>
          <button
            type="button"
            className={styles.sidebarClose}
            onClick={onClose}
            aria-label="Close filters"
          >
            ×
          </button>
        </div>

        <div className={styles.filterHeader}>
          <h2 className={styles.filterHeading}>Filter results</h2>
          <button
            type="button"
            className={styles.clearAll}
            onClick={onClear}
            disabled={selectedTags.length === 0}
          >
            Clear all
          </button>
        </div>

        <div className={styles.matchToggle} role="radiogroup" aria-label="Tag match mode">
          {MATCH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={match === option.value}
              className={`${styles.matchOption} ${
                match === option.value ? styles.matchOptionActive : ""
              }`}
              onClick={() => onMatchChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <ul className={styles.categoryList}>
          {groups.map((group) => {
            const isOpen = openGroups.has(group.key);
            const selectedCount = group.tags.filter((tag) => selectedTags.includes(tag.value)).length;
            const panelId = `scene-filter-${group.key}`;

            return (
              <li key={group.key} className={styles.category}>
                <button
                  type="button"
                  className={`${styles.categoryToggle} ${isOpen ? styles.categoryToggleOpen : ""}`}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className={styles.categoryLabel}>{group.label}</span>
                  {selectedCount > 0 && (
                    <span className={styles.categoryBadge}>{selectedCount}</span>
                  )}
                  <svg className={styles.chevron} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {isOpen && (
                  <ul id={panelId} className={styles.optionList}>
                    {group.tags.map((tag) => {
                      const count = tagCounts.get(tag.value) || 0;
                      const checked = selectedTags.includes(tag.value);

                      return (
                        <li key={tag.value}>
                          <label
                            className={`${styles.option} ${
                              count === 0 && !checked ? styles.optionEmpty : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={checked}
                              onChange={() => onToggleTag(tag.value)}
                            />
                            <span>{tag.label}</span>
                            <span className={styles.optionCount}>({count.toLocaleString()})</span>
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
      </aside>
    </>
  );
}
