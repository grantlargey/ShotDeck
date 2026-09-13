import { getScreenplaySceneHeading } from "@/shared/lib/screenplay";
import { formatSecondsToHms } from "@/shared/lib/time";
import { ScreenplayView } from "@/shared/ui";
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
 * Scene preview card: a slice of script paper rendered in screenplay layout,
 * above title, timing, and tag metadata. Shared by script search and the
 * script viewer, which wire click / double-click differently.
 */
export function SceneCard({
  scene,
  title,
  status,
  selected = false,
  tooltip,
  hasPopup = false,
  onClick,
  onDoubleClick,
  onKeyActivate,
}) {
  const text = displayScriptSceneText(scene);
  const heading = getScreenplaySceneHeading(text);
  const tags = safeScriptSceneTags(scene?.tags);
  const hasImage = Boolean(scene?.first_image_annotation?.id);
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
      className={`${styles.card} ${selected ? styles.selected : ""}`}
      aria-pressed={onKeyActivate ? selected : undefined}
      aria-haspopup={hasPopup ? "dialog" : undefined}
      aria-label={[cardTitle, pages, heading].filter(Boolean).join(", ")}
      title={tooltip}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
    >
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
          {status && <span className={styles.status}>{status}</span>}
          {hasImage && <span className={styles.imageBadge}>Image</span>}
        </div>
        {tags.length > 0 && (
          <div className={styles.tags}>
            {tags.slice(0, MAX_CARD_TAGS).map((tag) => (
              <span key={tag}>{getScriptTagLabel(tag)}</span>
            ))}
            {tags.length > MAX_CARD_TAGS && <span>+{tags.length - MAX_CARD_TAGS}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
