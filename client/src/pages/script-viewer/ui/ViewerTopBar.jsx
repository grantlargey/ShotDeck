import { Link } from "react-router-dom";
import {
  Badge,
  BrandLogo,
  Button,
  ChevronLeftIcon,
  EyeIcon,
  EyeOffIcon,
  IconButton,
  SearchIcon,
} from "@/shared/ui";
import styles from "./ScriptViewerPage.module.css";

/**
 * The viewer's only header. It stands in for the site header on this page so
 * the script gets the height: home link, back to the project, the title, and
 * viewer actions, in one sticky row at every width. The anchor-marker toggle
 * only matters while capturing, so visitors don't get it.
 */
export function ViewerTopBar({
  title,
  pageCount,
  sceneCount,
  canEdit,
  anchorMarkersVisible,
  onToggleAnchorMarkers,
  onBackToMovie,
  onSearchScripts,
  onJumpToScenes,
}) {
  const markersLabel = anchorMarkersVisible ? "Hide start and end markers" : "Show start and end markers";

  return (
    <header className={styles.topBar}>
      <Link to="/" className={styles.homeLink} aria-label="ScriptDeck home">
        <BrandLogo showWordmark={false} />
      </Link>

      <Button size="sm" className={styles.backButton} onClick={onBackToMovie} title="Back to project">
        <ChevronLeftIcon size={14} />
        <span className={styles.collapsibleLabel}>Project</span>
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
          <Badge tone="accent">{sceneCount}</Badge>
        </Button>
        <Button size="sm" onClick={onSearchScripts} title="Search all scripts">
          <SearchIcon size={14} />
          <span className={styles.collapsibleLabel}>Search all scripts</span>
        </Button>
      </div>
    </header>
  );
}
