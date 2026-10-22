import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { ChevronLeftIcon, EyeIcon, EyeOffIcon, SearchIcon } from "@/shared/ui/icons.jsx";
import styles from "./ScriptViewerPage.module.css";

/**
 * The viewer's tool bar, under the site header. It stays pinned when the site
 * header scrolls away, so the script keeps the height: back to the film,
 * the title, and viewer actions, in one row at every width. The
 * anchor-marker toggle only matters while capturing, so visitors don't get it.
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
  const markersLabel = anchorMarkersVisible ? "Hide start and end markers" : "Show start and end markers";

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
        {canEdit && (
          <IconButton size="sm" label={markersLabel} title={markersLabel} onClick={onToggleAnchorMarkers}>
            {anchorMarkersVisible ? <EyeIcon /> : <EyeOffIcon />}
          </IconButton>
        )}
        <Button size="sm" onClick={onJumpToScenes}>
          Scenes
          <Badge tone="accent" count>{sceneCount}</Badge>
        </Button>
        <Button size="sm" onClick={onSearchScripts} title="Search all scripts">
          <SearchIcon size={14} />
          <span className={styles.collapsibleLabel}>Search all scripts</span>
        </Button>
      </div>
    </header>
  );
}
