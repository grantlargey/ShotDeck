import { TagCategoryList } from "@/entities/script-scene";
import { Button, CloseIcon, IconButton, Input, SearchIcon, SegmentedControl } from "@/shared/ui";
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
  return (
    <>
      {open && <div className={styles.sidebarBackdrop} onClick={onClose} aria-hidden="true" />}

      <aside
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}
        aria-label="Scene filters"
      >
        <div className={styles.sidebarTop}>
          <Input
            icon={<SearchIcon />}
            className={styles.searchField}
            type="search"
            disabled
            placeholder="Search coming soon"
            aria-label="Search scenes (coming soon)"
          />
          <IconButton label="Close filters" className={styles.sidebarClose} onClick={onClose}>
            <CloseIcon size={18} />
          </IconButton>
        </div>

        <div className={styles.filterHeader}>
          <h2 className={styles.filterHeading}>Filter results</h2>
          <Button variant="link" size="sm" onClick={onClear} disabled={selectedTags.length === 0}>
            Clear all
          </Button>
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
          groups={groups}
          selectedTags={selectedTags}
          onToggleTag={onToggleTag}
          counts={tagCounts}
          idPrefix="scene-filter"
        />
      </aside>
    </>
  );
}
