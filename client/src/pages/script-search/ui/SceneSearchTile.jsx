import { useState } from "react";
import { SceneSearchField } from "@/features/scene-search/ui/SceneSearchField.jsx";
import { cx } from "@/shared/lib/cx.js";
import { useMediaQuery } from "@/shared/lib/useMediaQuery.js";
import styles from "./SceneSearchTile.module.css";

// At this width and below, the open tile lifts out of its place and spans the toolbar row.
const SPANNING_QUERY = "(max-width: 900px)";

/**
 * Script Search's semantic search: a 36px viewfinder tile beside the card
 * switches. Opening it (a click, a tap, or "/") widens it into the scene
 * search field as its corners pull focus, and example descriptions type
 * themselves out until you type. Enter or the shutter searches and closes the
 * tile; the page shows the search as a tag.
 *
 * value: the description in the field; query: the one last searched.
 * fieldRef: the tile's box, for the tag to fly in from. inputRef: the field.
 */
export function SceneSearchTile({
  value,
  query,
  examples,
  disabled = false,
  fieldRef,
  inputRef,
  onChange,
  onSubmit,
  onFocusChange,
}) {
  const spanning = useMediaQuery(SPANNING_QUERY);
  const [focused, setFocused] = useState(false);
  const draft = value.replace(/\s+/g, " ").trim();
  // Open while it has focus; on a wide screen also while it holds a description not yet searched.
  const open = !disabled && (focused || (!spanning && draft !== "" && draft !== query));

  return (
    <span className={styles.slot} role="search">
      <SceneSearchField
        className={cx(styles.box, open && styles.open, focused && styles.focused, disabled && styles.disabled)}
        title={disabled ? "Semantic search isn't available yet" : undefined}
        value={value}
        query={query}
        open={open}
        examples={examples}
        disabled={disabled}
        fieldRef={fieldRef}
        inputRef={inputRef}
        onChange={onChange}
        onSubmit={onSubmit}
        onFocusChange={(next) => {
          setFocused(next);
          onFocusChange?.(next);
        }}
      >
        <span className={styles.frame} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      </SceneSearchField>
    </span>
  );
}
