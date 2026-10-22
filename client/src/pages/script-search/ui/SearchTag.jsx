import { useLayoutEffect, useRef } from "react";
import { cx } from "@/shared/lib/cx.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { SearchIcon } from "@/shared/ui/icons.jsx";
import styles from "./SearchTag.module.css";

/**
 * The search's tag, first among the active filters: the description inside
 * viewfinder corners, like the tile it was typed in. While results load, a
 * film-leader sweep stands in for the magnifier. Clicking it reopens the
 * description for editing; × clears the search.
 *
 * flyFrom: the search field's box when it was searched, for the tag to fly in
 * from; onFlown says it has been used.
 * editing: the field is open on this description, so the tag steps back.
 */
export function SearchTag({ query, searching = false, editing = false, flyFrom, onFlown, onEdit, onClear }) {
  const tagRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!flyFrom) return;
    onFlown?.();
    const tag = tagRef.current;
    if (reducedMotion || !tag?.animate) return;
    const to = tag.getBoundingClientRect();
    const dx = flyFrom.left - to.left;
    const dy = flyFrom.top + (flyFrom.height - to.height) / 2 - to.top;
    tag.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.94)`, opacity: 0.35 },
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
      ],
      { duration: 560, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  }, [flyFrom, onFlown, reducedMotion]);

  return (
    <span ref={tagRef} className={cx(styles.tag, editing && styles.editing)} aria-busy={searching}>
      <button type="button" className={styles.main} title="Edit the description" onClick={onEdit}>
        {searching ? (
          <span className={styles.leader} aria-hidden="true" />
        ) : (
          <SearchIcon className={styles.icon} size={12} />
        )}
        <span className={styles.text}>“{query}”</span>
      </button>
      <button type="button" className={styles.clear} aria-label="Clear search" onClick={onClear}>
        <span aria-hidden="true">×</span>
      </button>
    </span>
  );
}
