import { cx } from "@/shared/lib/cx";
import { useSignedMediaUrl } from "@/shared/lib/media";
import { getScreenplaySceneHeading } from "@/shared/lib/screenplay";
import { formatSecondsToHms } from "@/shared/lib/time";
import { Badge, ImageIcon, ScreenplayView, Skeleton } from "@/shared/ui";
import {
  displayScriptSceneText,
  formatScriptScenePages,
  safeScriptSceneTags,
} from "../model/scriptSceneText.js";
import { getScriptTagLabel } from "../model/scriptTagCategories.js";
import styles from "./SceneCard.module.css";

const MAX_CARD_TAGS = 3;
const MAX_PREVIEW_ELEMENTS = 14;

function formatTiming(scene) {
  const start = scene?.start_time_seconds;
  const end = scene?.end_time_seconds;
  if (!Number.isFinite(start) && !Number.isFinite(end)) return "No timing yet";
  return `${formatSecondsToHms(start)} – ${formatSecondsToHms(end)}`;
}

/**
 * Scene preview card: a slice of script paper in screenplay layout above
 * title, timing, and tag metadata. Shared by script search and the script
 * viewer, which wire click / double-click differently.
 *
 * layout: "script" (paper only) | "split" (the scene's first film still over
 * an equal slice of paper, with a placeholder when no still falls in the scene)
 */
export function SceneCard({
  scene,
  title,
  layout = "script",
  status,
  selected = false,
  tooltip,
  hasPopup = false,
  onClick,
  onDoubleClick,
  onKeyActivate,
}) {
  const split = layout === "split";
  const text = displayScriptSceneText(scene);
  const heading = getScreenplaySceneHeading(text);
  const tags = safeScriptSceneTags(scene?.tags);
  // The card shows the still's thumbnail once the API has made one.
  const still = split ? scene?.first_image_annotation : null;
  const imageKey = still?.thumb_key || still?.image_key || null;
  const imageUrl = useSignedMediaUrl(imageKey);
  const cardTitle = title ?? (scene?.movie_title || "Unknown title");
  const pages = formatScriptScenePages(scene);

  function handleKeyDown(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    (onKeyActivate || onClick)?.(event);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cx(styles.card, split && styles.split, selected && styles.selected)}
      aria-pressed={onKeyActivate ? selected : undefined}
      aria-haspopup={hasPopup ? "dialog" : undefined}
      aria-label={[cardTitle, pages, heading].filter(Boolean).join(", ")}
      title={tooltip}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {split && (
        <div className={styles.still}>
          {imageKey ? (
            imageUrl && <img className={styles.stillImage} src={imageUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles.stillEmpty}>
              <ImageIcon size={18} />
              No still in this scene
            </span>
          )}
        </div>
      )}

      <div className={styles.paper}>
        {text.trim() ? (
          <ScreenplayView source={text} variant="card" maxElements={MAX_PREVIEW_ELEMENTS} />
        ) : (
          <p className={styles.empty}>No script text captured for this scene.</p>
        )}
      </div>

      <div className={styles.meta}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{cardTitle}</span>
          <span className={styles.pages}>{pages}</span>
        </div>
        <div className={styles.subRow}>
          <span>{formatTiming(scene)}</span>
          {status && <Badge tone="success">{status}</Badge>}
        </div>
        {tags.length > 0 && (
          <div className={styles.tags}>
            {tags.slice(0, MAX_CARD_TAGS).map((tag) => (
              <Badge key={tag}>{getScriptTagLabel(tag)}</Badge>
            ))}
            {tags.length > MAX_CARD_TAGS && <Badge>+{tags.length - MAX_CARD_TAGS}</Badge>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Placeholder with the card's shape, shown while scenes load. */
export function SceneCardSkeleton({ layout = "script" }) {
  const split = layout === "split";
  return (
    <div className={cx(styles.card, split && styles.split, styles.skeletonCard)} aria-hidden="true">
      {split && <Skeleton className={styles.skeletonStill} />}
      <Skeleton className={styles.skeletonPaper} />
      <div className={styles.meta}>
        <Skeleton className={styles.skeletonTitle} />
        <Skeleton className={styles.skeletonLine} />
      </div>
    </div>
  );
}
