import { getScriptTagLabel, safeScriptSceneTags } from "@/entities/script-scene";
import { formatSecondsToHms } from "@/shared/lib/time";
import { buildScenePreview, formatScenePages } from "../model/sceneBrowse.js";
import styles from "./ScriptSearchPage.module.css";

const MAX_CARD_TAGS = 3;

export default function SceneCard({ scene, onOpen }) {
  const { heading, excerpt } = buildScenePreview(scene);
  const tags = safeScriptSceneTags(scene.tags);
  const hasImage = Boolean(scene.first_image_annotation?.id);
  const title = scene.movie_title || "Unknown title";
  const label = [title, formatScenePages(scene), heading].filter(Boolean).join(", ");

  return (
    <button
      type="button"
      className={styles.card}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={label}
    >
      <span className={styles.cardPage}>
        {heading && <span className={styles.cardHeading}>{heading}</span>}
        {excerpt && <span className={styles.cardExcerpt}>{excerpt}</span>}
        {!heading && !excerpt && (
          <span className={styles.textEmpty}>No script text captured for this scene.</span>
        )}
      </span>

      <span className={styles.cardMeta}>
        <span className={styles.cardTitleRow}>
          <span className={styles.cardTitle}>{scene.movie_title || "Unknown title"}</span>
          <span className={styles.cardPages}>{formatScenePages(scene)}</span>
        </span>
        <span className={styles.cardSubRow}>
          {formatSecondsToHms(scene.start_time_seconds)} – {formatSecondsToHms(scene.end_time_seconds)}
          {hasImage && <span className={styles.imageBadge}>Image</span>}
        </span>
        {tags.length > 0 && (
          <span className={styles.cardTags}>
            {tags.slice(0, MAX_CARD_TAGS).map((tag) => (
              <span key={tag}>{getScriptTagLabel(tag)}</span>
            ))}
            {tags.length > MAX_CARD_TAGS && <span>+{tags.length - MAX_CARD_TAGS}</span>}
          </span>
        )}
      </span>
    </button>
  );
}
