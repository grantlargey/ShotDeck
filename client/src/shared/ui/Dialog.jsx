import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/shared/lib/cx.js";
import { IconButton } from "./IconButton.jsx";
import { CloseIcon } from "./icons.jsx";
import styles from "./Dialog.module.css";

/**
 * Centered modal dialog with a title row, body, and optional footer. Escape
 * and the backdrop close it; focus moves to the first field and returns to
 * the opener afterwards.
 *
 * It is drawn at the end of the document rather than where it is written. The
 * overlay covers the viewport through `position: fixed`, and an ancestor that
 * paints a backdrop filter — the site header does, to blur what scrolls under
 * it — becomes the containing block for fixed descendants. A dialog opened
 * from inside the header would then resolve `inset: 0` against the header's
 * own box and collapse to its height. Standing outside that subtree keeps the
 * overlay measured against the viewport, and keeps it above page chrome that
 * carries a stacking context of its own.
 */
export function Dialog({ title, onClose, footer, className, overlayClassName, renderContent, children }) {
  const titleId = useId();
  const bodyRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Skip hidden controls, such as a file picker's native input.
    const firstField = [...(bodyRef.current?.querySelectorAll("input, select, textarea, button") ?? [])].find(
      (element) => !element.disabled && element.getClientRects().length > 0
    );
    (firstField || closeRef.current)?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape" && !event.defaultPrevented) onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className={cx(styles.overlay, overlayClassName)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={cx(!renderContent && styles.panel, className)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {renderContent ? (
          renderContent({
            titleId,
            closeButton: (
              <IconButton ref={closeRef} size="sm" label="Close" onClick={onClose}>
                <CloseIcon size={16} />
              </IconButton>
            ),
          })
        ) : (
          <>
            <header className={styles.header}>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              <IconButton ref={closeRef} size="sm" label="Close" onClick={onClose}>
                <CloseIcon size={16} />
              </IconButton>
            </header>
            <div ref={bodyRef} className={styles.body}>
              {children}
            </div>
            {footer && <footer className={styles.footer}>{footer}</footer>}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
