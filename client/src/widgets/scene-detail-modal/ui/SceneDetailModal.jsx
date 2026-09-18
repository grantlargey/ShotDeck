import { useEffect } from "react";
import { cx } from "@/shared/lib/cx.js";
import { isTypingTarget } from "@/shared/lib/keyboard.js";
import { Dialog } from "@/shared/ui/Dialog.jsx";
import { ChevronLeftIcon, ChevronRightIcon } from "@/shared/ui/icons.jsx";
import styles from "./SceneDetailModal.module.css";

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
  actions,
  children,
}) {
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
      className={styles.modal}
      overlayClassName={styles.sceneOverlay}
      renderContent={({ titleId, closeButton }) => (
        <>
          <header className={styles.header}>
            <div className={styles.heading}>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              {meta && <p className={styles.meta}>{meta}</p>}
            </div>
            {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
            {counter && <span className={styles.counter}>{counter}</span>}
            {closeButton}
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

          {(footer || actions) && (
            <footer className={styles.footer}>
              {footer}
              {actions && <div className={styles.actions}>{actions}</div>}
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
