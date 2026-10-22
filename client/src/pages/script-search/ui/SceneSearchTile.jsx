import { useLayoutEffect, useRef, useState } from "react";
import { SceneSearchField } from "@/features/scene-search/ui/SceneSearchField.jsx";
import { cx } from "@/shared/lib/cx.js";
import { useMediaQuery } from "@/shared/lib/useMediaQuery.js";
import styles from "./SceneSearchTile.module.css";

// At this width and below, the open tile lifts out of its place and spans the toolbar row.
const SPANNING_QUERY = "(max-width: 900px)";
// Wider, it opens across the room its slot takes beside the heading. With less room
// than the longest example needs, it covers the heading instead.
const MIN_ROOM = 440;

/**
 * How long the tile takes to open and close, from how wide it opens: 300 ms and
 * 240 ms up to 400px, then a little longer the wider it goes, to 520 ms and 400 ms.
 */
function paceFor(width) {
  const extra = Math.max(0, width - 400);
  return {
    "--open-ms": `${Math.round(Math.min(520, 300 + extra * 0.22))}ms`,
    "--close-ms": `${Math.round(Math.min(400, 240 + extra * 0.15))}ms`,
  };
}

/**
 * The room the toolbar leaves the tile's slot, measured whenever the slot's
 * size changes: `width` is the slot's own, `span` runs from the start of the
 * toolbar's content to the slot's end, and `right` from the slot's end to the
 * toolbar's. The toolbar is the slot's positioned ancestor (Script Search pins
 * it). Null until measured, and where nothing is laid out.
 */
function useSlotRoom(slotRef) {
  const [room, setRoom] = useState(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    const measure = () => {
      const toolbar = slot.offsetParent;
      if (!toolbar) return;
      const end = slot.offsetLeft + slot.offsetWidth;
      const next = {
        width: slot.offsetWidth,
        span: end - (parseFloat(getComputedStyle(toolbar).paddingLeft) || 0),
        right: toolbar.clientWidth - end,
      };
      setRoom((current) =>
        current && current.width === next.width && current.span === next.span && current.right === next.right
          ? current
          : next
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slotRef]);

  return room;
}

/**
 * Script Search's semantic search: a 36px viewfinder tile beside the card
 * switches. Opening it (a click, a tap, or "/") widens it across the room
 * beside the heading into the scene search field as its corners pull focus,
 * and example descriptions type themselves out until you type. Where that room
 * is short, the open tile covers the heading instead. Enter or the shutter
 * searches and closes the tile; the page shows the search as a tag.
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
  const slotRef = useRef(null);
  const room = useSlotRoom(slotRef);
  const [focused, setFocused] = useState(false);
  const covering = !spanning && room !== null && room.width < MIN_ROOM;
  const draft = value.replace(/\s+/g, " ").trim();
  // Open while it has focus; beside the heading also while it holds a description not yet searched.
  const open = !disabled && (focused || (!spanning && !covering && draft !== "" && draft !== query));

  return (
    <span
      ref={slotRef}
      className={cx(styles.slot, covering && styles.covering)}
      style={
        room && !spanning
          ? { ...paceFor(covering ? room.span : room.width), "--cover-right": `${room.right}px` }
          : undefined
      }
      role="search"
    >
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
