import { FocusKey } from "@/features/focused-reading/ui/FocusKey.jsx";
import { SceneTextStyleToggle } from "@/features/scene-text-style/ui/SceneTextStyleToggle.jsx";
import { cx } from "@/shared/lib/cx.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { ChevronLeftIcon, SearchIcon } from "@/shared/ui/icons.jsx";
import { marksToggleLabel } from "../model/anchorNames.js";
import styles from "./ScriptViewerPage.module.css";

/** Begin and End's brackets, drawn dashed while they're hidden. */
export function MarksIcon({ hidden }) {
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
 * don't get it. On phones the actions move to the scenes' thumb dock
 * (`toolsInDock`), and the title keeps the focus key beside it, the page count
 * giving way.
 *
 * The meta line ends in the focused reading key (`focusable`: true once the
 * pages can be read, false while they load). In focus the bar's parts blur out
 * and the key docks in the screen's corner; `focusTop` pins a phone's bar
 * where it was while it fades, out of the pages' way.
 */
export function ViewerTopBar({
  ref,
  title,
  pageCount,
  sceneCount,
  canEdit,
  anchorMarkersVisible,
  focusable,
  focused = false,
  focusKeyRef,
  focusTop,
  toolsInDock = false,
  onToggleAnchorMarkers,
  onToggleFocus,
  onBackToFilm,
  onSearchScripts,
  onJumpToScenes,
}) {
  const markersLabel = marksToggleLabel(anchorMarkersVisible);

  return (
    <header
      ref={ref}
      className={cx(styles.topBar, focused && styles.topBarFocused)}
      style={focused && focusTop !== undefined ? { "--bar-focus-top": `${focusTop}px` } : undefined}
    >
      <Button
        size="sm"
        className={cx(styles.backButton, styles.recedes)}
        onClick={onBackToFilm}
        title="Back to film"
        inert={focused}
      >
        <ChevronLeftIcon size={14} />
        <span className={styles.collapsibleLabel}>Film</span>
      </Button>

      <div className={styles.titleGroup}>
        <h1 className={cx(styles.title, styles.recedes)}>{title}</h1>
        {(pageCount > 0 || focusable !== undefined) && (
          <p className={styles.titleMeta}>
            {pageCount > 0 && <span className={cx(styles.pageCount, styles.recedes)}>Script · {pageCount} pages</span>}
            {focusable !== undefined && (
              <>
                <span className={styles.recedes} aria-hidden="true">
                  ·
                </span>
                <FocusKey ref={focusKeyRef} on={focused} disabled={!focusable} onToggle={onToggleFocus} />
              </>
            )}
          </p>
        )}
      </div>

      {!toolsInDock && (
        <div className={cx(styles.topActions, styles.recedes)} inert={focused}>
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
      )}
    </header>
  );
}
