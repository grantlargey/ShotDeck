import { Badge, Button, ChevronLeftIcon, EyeIcon, EyeOffIcon, IconButton } from "@/shared/ui";
import styles from "./ScriptViewerPage.module.css";

export function ViewerTopBar({
  title,
  pageCount,
  sceneCount,
  anchorMarkersVisible,
  onToggleAnchorMarkers,
  onBackToMovie,
  onSearchScripts,
  onJumpToScenes,
}) {
  const markersLabel = anchorMarkersVisible ? "Hide start and end markers" : "Show start and end markers";

  return (
    <div className={styles.topBar}>
      <Button size="sm" className={styles.backButton} onClick={onBackToMovie}>
        <ChevronLeftIcon size={14} />
        Project
      </Button>

      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        {pageCount > 0 && <span className={styles.titleMeta}>Script · {pageCount} pages</span>}
      </div>

      <div className={styles.topActions}>
        <IconButton size="sm" label={markersLabel} title={markersLabel} onClick={onToggleAnchorMarkers}>
          {anchorMarkersVisible ? <EyeIcon /> : <EyeOffIcon />}
        </IconButton>
        <Button size="sm" onClick={onJumpToScenes}>
          Scenes
          <Badge tone="accent">{sceneCount}</Badge>
        </Button>
        <Button size="sm" onClick={onSearchScripts}>
          Search all scripts
        </Button>
      </div>
    </div>
  );
}
