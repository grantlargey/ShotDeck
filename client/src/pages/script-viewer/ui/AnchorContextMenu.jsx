import { useEffect, useRef } from "react";
import { formatFilmTiming } from "@/entities/script-scene/model/filmTiming.js";
import { undoShortcutLabel } from "../lib/platform.js";
import styles from "./AnchorContextMenu.module.css";

function MenuItem({ label, shortcut, tone, disabled = false, onSelect }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.item} ${tone ? styles[tone] : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={styles.swatch} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
    </button>
  );
}

/**
 * Right-click (or tap, on touch devices) menu for placing and removing line
 * anchors, positioned at the pointer.
 */
export function AnchorContextMenu({
  menu,
  anchors,
  canUndo,
  onSetAnchor,
  onRemoveAnchor,
  onClearAnchors,
  onUndo,
  onSelectScene,
  onClose,
}) {
  const menuRef = useRef(null);
  const { line } = menu;

  useEffect(() => {
    menuRef.current?.querySelector("button:not(:disabled)")?.focus();

    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [...menuRef.current.querySelectorAll("button:not(:disabled)")];
      const index = items.indexOf(document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);

  const run = (action) => () => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Anchor tools"
      className={styles.menu}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={styles.header}>
        <span className={styles.location}>
          Page {menu.pageNumber}
          {line ? ` · Line ${line.index + 1}` : ""}
        </span>
        <span className={styles.snippet}>
          {line
            ? line.text
            : menu.indexed
              ? "No text line under the pointer."
              : "Indexing this page's text…"}
        </span>
      </div>

      <MenuItem
        tone="start"
        label="Set start anchor"
        shortcut="["
        disabled={!line}
        onSelect={run(() => onSetAnchor("start", menu.pageNumber, line))}
      />
      <MenuItem
        tone="end"
        label="Set end anchor"
        shortcut="]"
        disabled={!line}
        onSelect={run(() => onSetAnchor("end", menu.pageNumber, line))}
      />

      <div className={styles.separator} role="separator" />

      <MenuItem label="Remove start anchor" disabled={!anchors.start} onSelect={run(() => onRemoveAnchor("start"))} />
      <MenuItem label="Remove end anchor" disabled={!anchors.end} onSelect={run(() => onRemoveAnchor("end"))} />
      <MenuItem label="Clear anchors" disabled={!anchors.start && !anchors.end} onSelect={run(onClearAnchors)} />
      <MenuItem label="Undo anchor change" shortcut={undoShortcutLabel()} disabled={!canUndo} onSelect={run(onUndo)} />

      {menu.scenes.length > 0 && (
        <>
          <div className={styles.separator} role="separator" />
          {menu.scenes.map((scene) => (
            <MenuItem
              key={scene.id}
              label={`Edit scene ${formatFilmTiming(scene)}`}
              onSelect={run(() => onSelectScene(scene))}
            />
          ))}
        </>
      )}
    </div>
  );
}
