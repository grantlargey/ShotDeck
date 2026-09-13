import { useEffect, useRef } from "react";
import { getSceneFirstStill, groupScriptTagsByCategory } from "@/entities/script-scene";
import { cx } from "@/shared/lib/cx";
import { useSignedMediaUrl } from "@/shared/lib/media";
import { formatSecondsToHms } from "@/shared/lib/time";
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  IconButton,
  ImageIcon,
  ScriptIcon,
  SegmentedControl,
} from "@/shared/ui";
import styles from "./SceneDetailModal.module.css";

function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * Full-screen scene dialog: a header (with an optional `toolbar`, such as the
 * view toggle), a tall stage for script paper, a still, or an editor, and a
 * footer beneath for metadata and actions. Stepping arrows appear when
 * `onStep` is provided.
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

/**
 * Switches a scene dialog between its script and its first film still. The
 * still option is unavailable when no still falls inside the scene's timing.
 */
export function SceneModalViewToggle({ value, onChange, hasStill }) {
  return (
    <SegmentedControl
      label="Scene view"
      value={hasStill ? value : "script"}
      onChange={onChange}
      options={[
        { value: "script", label: "Script", icon: <ScriptIcon size={14} /> },
        {
          value: "still",
          label: "Film still",
          icon: <ImageIcon size={14} />,
          disabled: !hasStill,
          title: hasStill ? undefined : "No film still falls inside this scene's timing",
        },
      ]}
    />
  );
}

/**
 * The scene's first film still, filling the stage in place of the script at
 * the same scale as the project page's still viewer.
 */
export function SceneModalStill({ scene }) {
  const still = getSceneFirstStill(scene);
  const url = useSignedMediaUrl(still?.image_key || null);
  if (!still) return null;
  const time = formatSecondsToHms(still.time_seconds);

  return (
    <figure className={styles.stillView}>
      {url ? (
        <img className={styles.stillImage} src={url} alt={`First film still in this scene, at ${time}`} />
      ) : (
        <span className={styles.stillPending}>Loading still…</span>
      )}
      <figcaption className={styles.stillCaption}>First still in this scene · {time}</figcaption>
    </figure>
  );
}

/**
 * The scene's tags grouped by category, for the footer beneath the stage.
 * Tags link back to Script Search when `onSelectTag` is given.
 */
export function SceneModalTags({ scene, onSelectTag }) {
  const groups = groupScriptTagsByCategory(scene?.tags);
  if (groups.length === 0) {
    return <p className={styles.noTags}>No tags on this scene yet.</p>;
  }

  return (
    <dl className={styles.tagGroups}>
      {groups.map((group) => (
        <div key={group.label} className={styles.tagGroup}>
          <dt>{group.label}</dt>
          <dd>
            {group.tags.map((tag, index) => (
              <span key={tag.value}>
                {onSelectTag ? (
                  <button
                    type="button"
                    className={styles.tagLink}
                    onClick={() => onSelectTag(tag.value)}
                    title={`Find scenes tagged ${tag.label}`}
                  >
                    {tag.label}
                  </button>
                ) : (
                  tag.label
                )}
                {index < group.tags.length - 1 && ", "}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SceneModalActions({ children }) {
  return <div className={styles.actions}>{children}</div>;
}

/** Footer action; a shared Button that stretches to fill the row on phones. */
export function SceneModalButton({ variant = "secondary", className, ...props }) {
  return <Button variant={variant} className={cx(styles.actionButton, className)} {...props} />;
}
