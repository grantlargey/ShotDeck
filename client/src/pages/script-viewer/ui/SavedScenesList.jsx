import { forwardRef } from "react";
import {
  displayScriptSceneText,
  getScriptTagLabel,
  safeScriptSceneTags,
} from "@/entities/script-scene";
import { formatSecondsToHms } from "@/shared/lib/time";
import styles from "./ScriptViewerPage.module.css";

const PREVIEW_TAG_LIMIT = 6;

export const SavedScenesList = forwardRef(function SavedScenesList(
  {
    activeSceneId,
    deletingSceneId,
    expandedSceneById,
    onDeleteScene,
    onOpenFirstImageAnnotation,
    onOpenScene,
    onSelectScene,
    scenes,
  },
  ref
) {
  return (
    <div ref={ref} className={styles.card}>
      <h2 className={styles.cardTitle}>Saved Script Scenes</h2>
      {scenes.length === 0 ? (
        <p className={styles.subtle}>No scene annotations yet.</p>
      ) : (
        <ul className={styles.annotationList}>
          {scenes.map((item) => {
            const tags = safeScriptSceneTags(item.tags);
            const previewTags = tags.slice(0, PREVIEW_TAG_LIMIT);
            const hiddenTagCount = Math.max(0, tags.length - PREVIEW_TAG_LIMIT);
            const page = Number(item.page_start || item.page_end || 1);
            const isActive = activeSceneId === item.id;
            const isExpanded = Boolean(expandedSceneById[item.id]);
            const previewText = displayScriptSceneText(item);
            return (
              <li
                key={item.id}
                className={`${styles.annotationItem} ${isActive ? styles.annotationItemActive : ""} ${
                  isExpanded ? styles.annotationItemExpanded : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.scenePreviewBtn}
                  onClick={() => onSelectScene(item)}
                >
                  <div className={styles.scenePreviewTop}>
                    <div className={styles.annotationMeta}>
                      {formatSecondsToHms(item.start_time_seconds)} -{" "}
                      {formatSecondsToHms(item.end_time_seconds)} | Page {page}
                    </div>
                    <span className={styles.sceneExpandHint}>
                      {isExpanded ? "Collapse" : "Expand"}
                    </span>
                  </div>
                  <p className={styles.scenePreviewText}>{previewText}</p>
                  {tags.length > 0 && (
                    <div className={styles.annotationTags}>
                      {previewTags.map((tag) => (
                        <span key={tag}>{getScriptTagLabel(tag)}</span>
                      ))}
                      {hiddenTagCount > 0 && (
                        <span className={styles.moreTags}>+{hiddenTagCount} more</span>
                      )}
                    </div>
                  )}
                </button>

                {isExpanded && (
                  <div className={styles.sceneExpandedBody}>
                    {tags.length > 0 && (
                      <div className={styles.annotationDetailTags}>
                        {tags.map((tag) => (
                          <span key={tag}>{getScriptTagLabel(tag)}</span>
                        ))}
                      </div>
                    )}
                    <p className={styles.annotationText}>{displayScriptSceneText(item)}</p>
                    <div className={styles.sceneActions}>
                      <button
                        type="button"
                        className={styles.jumpBtn}
                        onClick={() => onOpenScene(item)}
                      >
                        Open Scene
                      </button>
                      <button
                        type="button"
                        className={styles.jumpBtn}
                        disabled={!item.first_image_annotation?.id}
                        title={
                          item.first_image_annotation?.id
                            ? `Open first image annotation at ${formatSecondsToHms(
                                item.first_image_annotation.time_seconds
                              )}`
                            : "No image annotation falls inside this scene's timeframe."
                        }
                        onClick={() => onOpenFirstImageAnnotation(item)}
                      >
                        Open First Image
                      </button>
                      <button
                        type="button"
                        className={styles.rowDeleteBtn}
                        disabled={deletingSceneId === item.id}
                        onClick={() => onDeleteScene(item.id)}
                      >
                        {deletingSceneId === item.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
