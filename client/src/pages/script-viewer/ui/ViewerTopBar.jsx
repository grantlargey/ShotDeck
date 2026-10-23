import { SceneTextStyleToggle } from "@/features/scene-text-style/ui/SceneTextStyleToggle.jsx";
import { cx } from "@/shared/lib/cx.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { ChevronLeftIcon, SearchIcon } from "@/shared/ui/icons.jsx";
import { ANCHOR_NAMES } from "../model/anchorNames.js";
import styles from "./ScriptViewerPage.module.css";

/** Begin and End's brackets, drawn dashed while they're hidden. */
function MarksIcon({ hidden }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={hidden ? "1.5 2.6" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.75 2.75H3.5v10.5h2.25M10.25 2.75h2.25v10.5h-2.25" />
    </svg>
  );
}

/**
 * The viewer's tool bar, under the site header. It stays pinned when the site
 * header scrolls away, so the script keeps the height: back to the film,
 * the title, and viewer actions, in one row at every width. Everyone can turn
 * the page style, which the script's pages follow like the rest of the site;
 * the Begin and End marks toggle only matters while capturing, so visitors
 * don't get it.
 */
export function ViewerTopBar({
  title,
  pageCount,
  sceneCount,
  canEdit,
  anchorMarkersVisible,
  onToggleAnchorMarkers,
  onBackToFilm,
  onSearchScripts,
  onJumpToScenes,
}) {
  const markersLabel = `${anchorMarkersVisible ? "Hide" : "Show"} the ${ANCHOR_NAMES.start} and ${ANCHOR_NAMES.end} marks`;

  return (
    <header className={styles.topBar}>
      <Button size="sm" className={styles.backButton} onClick={onBackToFilm} title="Back to film">
        <ChevronLeftIcon size={14} />
        <span className={styles.collapsibleLabel}>Film</span>
      </Button>

      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        {pageCount > 0 && <span className={styles.titleMeta}>Script · {pageCount} pages</span>}
      </div>

      <div className={styles.topActions}>
        <SceneTextStyleToggle look="bar" />
        {canEdit && (
          <IconButton
            size="sm"
            className={cx(anchorMarkersVisible && styles.marksShown)}
            label={markersLabel}
            title={markersLabel}
            onClick={onToggleAnchorMarkers}
          >
            <MarksIcon hidden={!anchorMarkersVisible} />
          </IconButton>
        )}
        <Button size="sm" onClick={onJumpToScenes}>
          Scenes
          <Badge count>{sceneCount}</Badge>
        </Button>
        <Button size="sm" onClick={onSearchScripts} title="Search all scripts">
          <SearchIcon size={14} />
          <span className={styles.collapsibleLabel}>Search all scripts</span>
        </Button>
      </div>
    </header>
  );
}
