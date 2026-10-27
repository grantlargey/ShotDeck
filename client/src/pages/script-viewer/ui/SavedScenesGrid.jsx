import { SceneCard } from "@/entities/script-scene/ui/SceneCard.jsx";
import { useMediaQuery } from "@/shared/lib/useMediaQuery.js";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { SceneBrowser } from "@/widgets/scene-browser/ui/SceneBrowser.jsx";
import { ANCHOR_NAMES } from "../model/anchorNames.js";
import styles from "./ScriptViewerPage.module.css";

// Touch screens, where a double-click can't land: the first tap's edit jumps the page up to the script.
const TOUCH_SCREEN_QUERY = "(pointer: coarse)";

/**
 * The script's captured scenes. Admins click a card to edit it and
 * double-click to expand, or on a touch screen tap to open it and hold to
 * edit; visitors (`readOnly`) open the scene. On a phone the viewer adds to
 * the scene browser's thumb dock (`thumbDock`).
 */
export function SavedScenesGrid({
  ref,
  inert,
  thumbDock,
  scriptId,
  scenes,
  selectedSceneId,
  title,
  readOnly = false,
  onSelect,
  onExpand,
}) {
  const touchScreen = useMediaQuery(TOUCH_SCREEN_QUERY);
  const instruction = readOnly
    ? `${touchScreen ? "Tap" : "Click"} a card to open the scene`
    : touchScreen
      ? "Tap a card to open it · Hold to edit it"
      : "Click a card to edit it · Double-click to expand";

  return (
    <section ref={ref} className={styles.scenes} aria-labelledby="saved-scenes-title" inert={inert}>
      <SceneBrowser
        scope={{ scriptId, scenes }}
        thumbDock={thumbDock}
        headingId="saved-scenes-title"
        title="Scenes captured"
        instruction={instruction}
        emptyState={
          <EmptyState compact title="No scenes yet">
            {readOnly
              ? "No scenes have been captured for this script yet."
              : `Right-click a line in the script and choose ${ANCHOR_NAMES.start} to start one.`}
          </EmptyState>
        }
        renderScene={(scene, display) => {
          const selected = scene.id === selectedSceneId;
          return (
            <SceneCard
              scene={scene}
              {...display}
              title={title}
              selected={selected}
              status={!readOnly && selected ? "Editing" : undefined}
              tooltip={readOnly ? "Open the scene" : "Click to edit · Double-click to expand"}
              hasPopup
              onClick={() => readOnly ? onExpand(scene) : onSelect(scene)}
              onDoubleClick={readOnly ? undefined : () => onExpand(scene)}
              onKeyActivate={readOnly ? undefined : () => selected ? onExpand(scene) : onSelect(scene)}
              touch={
                readOnly
                  ? undefined
                  : { onTap: () => onExpand(scene), onHold: () => onSelect(scene), holdLabel: "Keep holding to edit" }
              }
            />
          );
        }}
      />
    </section>
  );
}
