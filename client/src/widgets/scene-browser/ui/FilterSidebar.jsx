import { useEffect, useId, useRef } from "react";
import { TagCategoryList } from "@/entities/script-scene/ui/TagCategoryList.jsx";
import { cx } from "@/shared/lib/cx.js";
import { Button } from "@/shared/ui/Button.jsx";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import styles from "./SceneBrowser.module.css";

const MATCH_OPTIONS = [
  { value: "all", label: "Match all" },
  { value: "any", label: "Match any" },
];

/** A book seen from its spine with the cover ajar; the cover closes or opens as the panel will. */
export function FoldIcon() {
  return (
    <svg
      className={styles.foldIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.cover} d="M4 2.5L12 4.25V11.75L4 13.5Z" />
      <path d="M4 2.5V13.5" />
    </svg>
  );
}

/**
 * The scene filters. On wide screens (`docked`) they sit in a column beside
 * the grid and can fold away: the panel swings shut onto a spine down the
 * column's edge, and the spine brings them back. On narrow screens they open
 * as a drawer instead, which swings in from the screen's edge and back the
 * same way; there the book button beside Clear all closes it.
 *
 * folded: the filters are folded away; it only applies while docked.
 * motion: "folding" | "unfolding" while the panel swings, otherwise null.
 */
export default function FilterSidebar({
  groups,
  tagCounts,
  selectedTags,
  match,
  open,
  docked,
  folded,
  motion,
  onClose,
  onFold,
  onUnfold,
  onToggleTag,
  onMatchChange,
  onClear,
}) {
  const panelId = useId();
  const foldRef = useRef(null);
  const spineRef = useRef(null);
  // Whether the control that folded or unfolded the panel had focus, so the one that undoes it takes it over.
  const handOffFocusRef = useRef(false);
  const away = docked && folded;
  const count = selectedTags.length;

  useEffect(() => {
    if (!handOffFocusRef.current) return;
    handOffFocusRef.current = false;
    (away ? spineRef : foldRef).current?.focus({ preventScroll: true });
  }, [away]);

  function fold() {
    handOffFocusRef.current = document.activeElement === foldRef.current;
    onFold();
  }

  function unfold() {
    handOffFocusRef.current = document.activeElement === spineRef.current;
    onUnfold();
  }

  return (
    <>
      {/* Always there, so it can clear as the drawer swings shut. */}
      <div className={cx(styles.sidebarBackdrop, open && styles.sidebarBackdropOpen)} onClick={onClose} aria-hidden="true" />

      <div className={styles.dock}>
        <aside
          id={panelId}
          className={cx(
            styles.sidebar,
            open && styles.sidebarOpen,
            motion === "folding" && styles.sidebarFolding,
            motion === "unfolding" && styles.sidebarUnfolding,
            away && !motion && styles.sidebarAway
          )}
          aria-label="Scene filters"
          inert={away}
        >
          <div className={styles.filterHeader}>
            <h2 className={styles.filterHeading}>Filter results</h2>
            <div className={styles.filterHeaderEnd}>
              <Button
                variant="link"
                size="sm"
                className={styles.clearFilters}
                onClick={onClear}
                disabled={count === 0}
              >
                Clear all
              </Button>
              <IconButton
                ref={foldRef}
                size="sm"
                className={styles.fold}
                label={docked ? "Fold the filters away" : "Close filters"}
                title={docked ? "Fold the filters away" : "Close filters"}
                aria-expanded={docked ? !away : open}
                aria-controls={panelId}
                onClick={docked ? fold : onClose}
              >
                <FoldIcon />
              </IconButton>
            </div>
          </div>

          <SegmentedControl
            block
            label="Tag match mode"
            options={MATCH_OPTIONS}
            value={match}
            onChange={onMatchChange}
            className={styles.matchToggle}
          />

          <TagCategoryList
            look="quiet"
            groups={groups}
            selectedTags={selectedTags}
            onToggleTag={onToggleTag}
            counts={tagCounts}
            idPrefix="scene-filter"
          />
        </aside>

        {docked && (away || motion === "unfolding") && (
          <button
            ref={spineRef}
            type="button"
            className={cx(
              styles.spine,
              motion === "folding" && styles.spineArriving,
              motion === "unfolding" && styles.spineLeaving
            )}
            aria-label={count ? `Show filters, ${count} selected` : "Show filters"}
            title="Show filters"
            aria-expanded={false}
            aria-controls={panelId}
            inert={motion === "unfolding"}
            onClick={unfold}
          >
            <span className={styles.spineContent}>
              <FoldIcon />
              <span className={styles.spineLabel} aria-hidden="true">
                Filters
              </span>
              {count > 0 && (
                <span className={styles.spineCount} aria-hidden="true">
                  {count}
                </span>
              )}
            </span>
          </button>
        )}
      </div>
    </>
  );
}
