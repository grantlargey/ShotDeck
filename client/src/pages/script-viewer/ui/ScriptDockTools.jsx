import { cx } from "@/shared/lib/cx.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { ChevronUpIcon, SearchIcon } from "@/shared/ui/icons.jsx";
import { DockButton, DockPageStyle, DockRule, DockTile } from "@/widgets/scene-browser/ui/ThumbDock.jsx";
import { marksToggleLabel } from "../model/anchorNames.js";
import { MarksIcon } from "./ViewerTopBar.jsx";
import styles from "./ScriptViewerPage.module.css";

/**
 * What the captured scenes' thumb dock holds over the script on a phone (its
 * `elsewhere`): the page style, for admins the Begin and End marks, the way
 * down to the scenes, and Script Search. Going down to the scenes, it notes in
 * `returnRef` where the reader was in the script, for BackToScriptTile.
 */
export function ScriptDockTools({
  returnRef,
  canEdit,
  anchorMarkersVisible,
  sceneCount,
  onToggleAnchorMarkers,
  onJumpToScenes,
  onSearchScripts,
}) {
  const markersLabel = marksToggleLabel(anchorMarkersVisible);

  return (
    <>
      <DockPageStyle />
      {canEdit && (
        <DockTile
          className={cx(styles.marksToggle, anchorMarkersVisible && styles.marksShown)}
          label={markersLabel}
          title={markersLabel}
          onClick={onToggleAnchorMarkers}
        >
          <MarksIcon hidden={!anchorMarkersVisible} />
        </DockTile>
      )}
      <DockRule />
      <DockButton
        onClick={() => {
          returnRef.current = window.scrollY;
          onJumpToScenes();
        }}
      >
        Scenes
        <Badge count>{sceneCount}</Badge>
      </DockButton>
      <DockRule />
      <DockTile label="Search all scripts" title="Search all scripts" onClick={onSearchScripts}>
        <SearchIcon size={16} />
      </DockTile>
    </>
  );
}

/**
 * The captured scenes' dock's way back up (its `lead`): to where the reader
 * was in the script when the dock took them down, or else to the script's end,
 * just above the scenes.
 */
export function BackToScriptTile({ returnRef, scenesRef }) {
  const reducedMotion = usePrefersReducedMotion();

  function backToScript() {
    const scenes = scenesRef.current;
    const scriptEnd = scenes ? scenes.getBoundingClientRect().top + window.scrollY - window.innerHeight : 0;
    const top = returnRef.current ?? scriptEnd;
    returnRef.current = null;
    window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
  }

  return (
    <DockTile label="Back to the script" title="Back to the script" onClick={backToScript}>
      <ChevronUpIcon size={18} />
    </DockTile>
  );
}
