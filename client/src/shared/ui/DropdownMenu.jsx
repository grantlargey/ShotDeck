import { useEffect, useRef, useState } from "react";
import { cx } from "@/shared/lib/cx.js";
import { IconButton } from "./IconButton.jsx";
import { MoreIcon } from "./icons.jsx";
import styles from "./DropdownMenu.module.css";

/**
 * "More actions" button that opens a small menu. Closes on selection, on a
 * click outside, or on Escape.
 *
 * items: [{ key, label, onSelect, tone?: "danger", disabled? }]
 * trigger: optional `(props) => element` to render your own button; spread
 *   `props` onto it so the menu opens and is announced correctly.
 * header: optional content shown above the items, such as who is signed in.
 */
export function DropdownMenu({ label = "More actions", items, triggerVariant = "ghost", trigger, header, className }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    menuRef.current?.querySelector("button:not(:disabled)")?.focus();

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const triggerProps = {
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: () => setOpen((value) => !value),
  };

  return (
    <div ref={rootRef} className={cx(styles.root, className)}>
      {trigger ? (
        trigger(triggerProps)
      ) : (
        <IconButton size="sm" variant={triggerVariant} label={label} {...triggerProps}>
          <MoreIcon />
        </IconButton>
      )}

      {open && (
        <div ref={menuRef} role="menu" aria-label={label} className={styles.menu}>
          {header && <div className={styles.header}>{header}</div>}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={cx(styles.item, item.tone === "danger" && styles.danger)}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
