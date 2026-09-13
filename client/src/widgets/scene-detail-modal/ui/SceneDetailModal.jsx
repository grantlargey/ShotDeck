import { useEffect, useRef } from "react";
import { cx } from "@/shared/lib/cx";
import { Button, ChevronLeftIcon, ChevronRightIcon, CloseIcon, IconButton } from "@/shared/ui";
import styles from "./SceneDetailModal.module.css";

function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * Full-screen dialog frame shared by the scene viewer and the draft editor: a
 * header (with an optional `toolbar`), a tall stage, and a footer beneath for
 * metadata and actions. Stepping arrows appear when `onStep` is provided.
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
  children,
}) {
  const closeRef = useRef(null);

  // Lock page scroll while open and hand focus back to the opener on close.
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!onStep || isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft" && hasPrev) onStep(-1);
      else if (event.key === "ArrowRight" && hasNext) onStep(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasPrev, hasNext, onClose, onStep]);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="scene-detail-title">
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id="scene-detail-title" className={styles.title}>
              {title}
            </h2>
            {meta && <p className={styles.meta}>{meta}</p>}
          </div>
          {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
          {counter && <span className={styles.counter}>{counter}</span>}
          <IconButton ref={closeRef} label="Close" onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.2} />
          </IconButton>
        </header>

        <div className={cx(styles.stage, !onStep && styles.stageSolo)}>
          {onStep && (
            <button
              type="button"
              className={styles.stepButton}
              onClick={() => onStep(-1)}
              disabled={!hasPrev}
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
              className={styles.stepButton}
              onClick={() => onStep(1)}
              disabled={!hasNext}
              aria-label="Next"
            >
              <ChevronRightIcon size={18} strokeWidth={2.4} />
            </button>
          )}
        </div>

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
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

export function SceneModalActions({ children }) {
  return <div className={styles.actions}>{children}</div>;
}

/** Footer action; a shared Button that stretches to fill the row on phones. */
export function SceneModalButton({ variant = "secondary", className, ...props }) {
  return <Button variant={variant} className={cx(styles.actionButton, className)} {...props} />;
}
