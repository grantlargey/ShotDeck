import { useEffect, useRef, useState } from "react";
import { displayScriptSceneText } from "@/entities/script-scene";
import { api } from "@/shared/api";
import { formatSecondsToHms } from "@/shared/lib/time";
import { formatScenePages, groupTagsByCategory } from "../model/sceneBrowse.js";
import styles from "./ScriptSearchPage.module.css";

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

export default function SceneDetailModal({
  scene,
  index,
  total,
  onClose,
  onStep,
  onOpenInScript,
  onOpenFirstImage,
}) {
  const closeRef = useRef(null);
  const [imageUrlByKey, setImageUrlByKey] = useState({});

  const text = displayScriptSceneText(scene);
  const tagGroups = groupTagsByCategory(scene.tags);
  const firstImage = scene.first_image_annotation;
  const imageKey = firstImage?.image_key;
  const imageUrl = imageKey ? imageUrlByKey[imageKey] : null;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  // Lock page scroll while open and hand focus back to the card on close.
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
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onStep(-1);
      else if (e.key === "ArrowRight" && hasNext) onStep(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasPrev, hasNext, onClose, onStep]);

  useEffect(() => {
    if (!imageKey || imageUrlByKey[imageKey]) return;
    let cancelled = false;
    api
      .getViewUrlForKey(imageKey)
      .then(({ url }) => {
        if (!cancelled && url) setImageUrlByKey((prev) => ({ ...prev, [imageKey]: url }));
      })
      .catch(() => {
        // The thumbnail is optional; the Open First Image action still works.
      });
    return () => {
      cancelled = true;
    };
  }, [imageKey, imageUrlByKey]);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-detail-title"
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalHeading}>
            <h2 id="scene-detail-title" className={styles.modalTitle}>
              {scene.movie_title || "Unknown title"}
            </h2>
            <p className={styles.modalMeta}>
              {formatScenePages(scene)} · {formatSecondsToHms(scene.start_time_seconds)} –{" "}
              {formatSecondsToHms(scene.end_time_seconds)}
            </p>
          </div>
          <span className={styles.modalCounter}>
            {index + 1} / {total}
          </span>
          <button
            ref={closeRef}
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close scene"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className={styles.modalStage}>
          <button
            type="button"
            className={styles.stepButton}
            onClick={() => onStep(-1)}
            disabled={!hasPrev}
            aria-label="Previous scene"
          >
            <Arrow direction="left" />
          </button>

          {/* Keyed so each scene starts reading from the top. */}
          <div key={scene.id} className={styles.modalPaper} tabIndex={0} aria-label="Scene text">
            {text ? (
              <pre className={styles.modalText}>{text}</pre>
            ) : (
              <p className={styles.textEmpty}>No script text captured for this scene.</p>
            )}
          </div>

          <button
            type="button"
            className={styles.stepButton}
            onClick={() => onStep(1)}
            disabled={!hasNext}
            aria-label="Next scene"
          >
            <Arrow direction="right" />
          </button>
        </div>

        <footer className={styles.modalFooter}>
          {tagGroups.length > 0 && (
            <dl className={styles.tagGroups}>
              {tagGroups.map((group) => (
                <div key={group.label} className={styles.tagGroup}>
                  <dt>{group.label}:</dt>
                  <dd>{group.values.join(", ")}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className={styles.modalActions}>
            {imageUrl && (
              <button
                type="button"
                className={styles.imageThumb}
                onClick={() => onOpenFirstImage(scene)}
                aria-label="Open first image annotation"
              >
                <img src={imageUrl} alt="" />
              </button>
            )}
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() => onOpenInScript(scene)}
            >
              Open Scene In Script
            </button>
            <button
              type="button"
              className={styles.secondaryAction}
              disabled={!firstImage?.id}
              title={
                firstImage?.id
                  ? `Open first image annotation at ${formatSecondsToHms(firstImage.time_seconds)}`
                  : "No image annotation falls inside this scene's timeframe."
              }
              onClick={() => onOpenFirstImage(scene)}
            >
              Open First Image
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
