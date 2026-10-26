import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { KEY_GLIDE, glideFrom, readBox } from "@/features/focused-reading/model/focusMotion.js";
import { focusQuietly } from "@/features/focused-reading/model/focusQuietly.js";
import { useFocusKeys } from "@/features/focused-reading/model/useFocusKeys.js";
import { FocusKey } from "@/features/focused-reading/ui/FocusKey.jsx";
import { cx } from "@/shared/lib/cx.js";
import { isTypingTarget } from "@/shared/lib/keyboard.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { Dialog } from "@/shared/ui/Dialog.jsx";
import { ChevronLeftIcon, ChevronRightIcon } from "@/shared/ui/icons.jsx";
import styles from "./SceneDetailModal.module.css";

/**
 * Full-screen dialog frame shared by the scene viewer and the draft editor: a
 * header (with an optional `toolbar`), a tall stage, and a footer beneath for
 * metadata and actions. Stepping arrows appear when `onStep` is provided.
 *
 * `focusable` adds the focused reading key to the end of the meta line: true
 * while there's scene text to read, false to show it resting. Focus clears
 * the dialog down to the paper (see SceneDetailModal.module.css); the arrow
 * keys still step, F or the key leaves it, and so does Esc, before a second
 * Esc closes the dialog.
 */
export function SceneDetailModal({
  title,
  meta,
  counter,
  toolbar,
  hasPrev = false,
  hasNext = false,
  onStep,
  onClose,
  stageKey,
  footer,
  actions,
  focusable,
  children,
}) {
  const [focusOn, setFocusOn] = useState(false);
  // Focus ends with the scene text, such as on stepping to a moment without one.
  if (focusOn && focusable !== true) setFocusOn(false);
  const focused = focusOn && focusable === true;
  const reducedMotion = usePrefersReducedMotion();
  const headerRef = useRef(null);
  const keyRef = useRef(null);
  // The key's box when focus last changed, for it to glide from.
  const keyFromRef = useRef(null);

  function setFocus(next) {
    if (next === focused || (next && focusable !== true)) return;
    keyFromRef.current = readBox(keyRef.current);
    setFocusOn(next);
  }

  useFocusKeys({ enabled: focusable !== undefined, focused, canFocus: focusable === true, onChange: setFocus });

  useLayoutEffect(() => {
    const from = keyFromRef.current;
    keyFromRef.current = null;
    if (!from) return;
    // Keyboard focus goes to the paper, so the keys scroll the text, and the key in its corner stays a ghost.
    const active = document.activeElement;
    if (focused && (!active || active === document.body || active === keyRef.current || active.closest("[inert]"))) {
      const dialog = headerRef.current?.closest('[role="dialog"]');
      focusQuietly(dialog?.querySelector(`.${styles.paper}`));
    }
    if (!reducedMotion) glideFrom(keyRef.current, from, focused ? KEY_GLIDE.in : KEY_GLIDE.out);
  }, [focused, reducedMotion]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented) return;
      if (!onStep || isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft" && hasPrev) onStep(-1);
      else if (event.key === "ArrowRight" && hasNext) onStep(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasPrev, hasNext, onStep]);

  return (
    <Dialog
      title={title}
      onClose={onClose}
      className={cx(styles.modal, focused && styles.focused)}
      overlayClassName={cx(styles.sceneOverlay, focused && styles.overlayFocused)}
      renderContent={({ titleId, closeButton }) => (
        <>
          <header ref={headerRef} className={styles.header}>
            <div className={styles.headerRow}>
              <div className={styles.heading}>
                <h2 id={titleId} className={cx(styles.title, styles.recedes)}>
                  {title}
                </h2>
                {(meta || focusable !== undefined) && (
                  <p className={styles.meta}>
                    {meta && <span className={styles.recedes}>{meta}</span>}
                    {meta && focusable !== undefined && (
                      <span className={styles.recedes} aria-hidden="true">
                        ·
                      </span>
                    )}
                    {focusable !== undefined && (
                      <FocusKey ref={keyRef} on={focused} disabled={!focusable} onToggle={setFocus} />
                    )}
                  </p>
                )}
              </div>
              {toolbar && (
                <div className={cx(styles.toolbar, styles.recedes)} inert={focused}>
                  {toolbar}
                </div>
              )}
              {counter && <span className={cx(styles.counter, styles.recedes)}>{counter}</span>}
              <span className={cx(styles.close, styles.recedes)} inert={focused}>
                {closeButton}
              </span>
            </div>
          </header>

          <div className={cx(styles.stage, !onStep && styles.stageSolo)}>
            {onStep && (
              <button
                type="button"
                className={cx(styles.stepButton, styles.recedes)}
                onClick={() => onStep(-1)}
                disabled={!hasPrev}
                inert={focused}
                aria-label="Previous"
              >
                <ChevronLeftIcon size={18} strokeWidth={2.4} />
              </button>
            )}

            <div key={stageKey} className={styles.stageBody}>
              {children}
            </div>

            {onStep && (
              <button
                type="button"
                className={cx(styles.stepButton, styles.recedes)}
                onClick={() => onStep(1)}
                disabled={!hasNext}
                inert={focused}
                aria-label="Next"
              >
                <ChevronRightIcon size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>

          {(footer || actions) && (
            <footer className={styles.footer} inert={focused}>
              <div className={cx(styles.footerRow, styles.recedes)}>
                {footer}
                {actions && <div className={styles.actions}>{actions}</div>}
              </div>
            </footer>
          )}
        </>
      )}
    />
  );
}

export function SceneModalPaper({ label = "Scene text", heading, toolbar, children }) {
  return (
    <section className={styles.paperColumn} aria-label={label}>
      {heading && <h3 className={styles.paperHeading}>{heading}</h3>}
      {toolbar}
      <div className={styles.paper} tabIndex={0}>
        {children}
      </div>
    </section>
  );
}
