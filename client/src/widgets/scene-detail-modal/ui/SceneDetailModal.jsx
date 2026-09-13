import { useEffect, useRef, useState } from "react";
import { api } from "@/shared/api";
import styles from "./SceneDetailModal.module.css";

function Arrow({ direction }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d={direction === "left" ? "M11 3.5L5.5 9l5.5 5.5" : "M7 3.5L12.5 9 7 14.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * Full-screen scene dialog: header, a "stage" holding script paper (or an
 * editor), and a footer for tags and actions. Stepping arrows appear when
 * `onStep` is provided.
 */
export function SceneDetailModal({
  title,
  meta,
  counter,
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
          {counter && <span className={styles.counter}>{counter}</span>}
          <button
            ref={closeRef}
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className={`${styles.stage} ${onStep ? "" : styles.stageSolo}`}>
          {onStep && (
            <button
              type="button"
              className={styles.stepButton}
              onClick={() => onStep(-1)}
              disabled={!hasPrev}
              aria-label="Previous scene"
            >
              <Arrow direction="left" />
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
              aria-label="Next scene"
            >
              <Arrow direction="right" />
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

export function SceneModalTagGroups({ groups }) {
  if (!groups?.length) return null;
  return (
    <dl className={styles.tagGroups}>
      {groups.map((group) => (
        <div key={group.label} className={styles.tagGroup}>
          <dt>{group.label}:</dt>
          <dd>{group.values.join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SceneModalActions({ children }) {
  return <div className={styles.actions}>{children}</div>;
}

const BUTTON_VARIANTS = {
  primary: styles.primaryAction,
  secondary: styles.secondaryAction,
  danger: styles.dangerAction,
};

export function SceneModalButton({ variant = "secondary", className = "", ...props }) {
  return (
    <button type="button" className={`${BUTTON_VARIANTS[variant] || styles.secondaryAction} ${className}`} {...props} />
  );
}

/**
 * Thumbnail of the first image annotation inside a scene's time range. It is
 * optional decoration: the explicit "Open First Image" action still works if
 * the signed URL cannot be fetched.
 */
export function SceneFirstImageThumb({ scene, onOpen }) {
  const imageKey = scene?.first_image_annotation?.image_key;
  const [urlByKey, setUrlByKey] = useState({});
  const url = imageKey ? urlByKey[imageKey] : null;

  useEffect(() => {
    if (!imageKey || urlByKey[imageKey]) return undefined;
    let cancelled = false;
    api
      .getViewUrlForKey(imageKey)
      .then(({ url: viewUrl }) => {
        if (!cancelled && viewUrl) setUrlByKey((prev) => ({ ...prev, [imageKey]: viewUrl }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imageKey, urlByKey]);

  if (!url) return null;
  return (
    <button
      type="button"
      className={styles.imageThumb}
      onClick={() => onOpen(scene)}
      aria-label="Open first image annotation"
    >
      <img src={url} alt="" />
    </button>
  );
}
