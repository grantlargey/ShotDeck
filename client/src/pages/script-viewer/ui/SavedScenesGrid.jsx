import { SceneCard } from "@/entities/script-scene/ui/SceneCard.jsx";
import { Badge } from "@/shared/ui/Badge.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import styles from "./ScriptViewerPage.module.css";

/**
 * The script's captured scenes. Admins click a card to edit it and
 * double-click to expand; visitors (`readOnly`) click to open the scene.
 */
export function SavedScenesGrid({ ref, scenes, selectedSceneId, title, readOnly = false, onSelect, onExpand }) {
  return (
    <section ref={ref} className={styles.scenes} aria-labelledby="saved-scenes-title">
      <div className={styles.scenesHeader}>
        <h2 id="saved-scenes-title" className={styles.scenesTitle}>
          Scenes in this script
          <Badge tone="accent">{scenes.length}</Badge>
        </h2>
        <p className={styles.scenesHint}>
          {readOnly ? "Click a card to open the scene" : "Click a card to edit it · Double-click to expand"}
        </p>
      </div>

      {scenes.length === 0 ? (
        <EmptyState compact title="No scenes yet">
          {readOnly
            ? "No scenes have been captured for this script yet."
            : "Right-click a line in the script to place a start anchor and begin one."}
        </EmptyState>
      ) : (
        <ul className={styles.sceneGrid}>
          {scenes.map((scene) => {
            const selected = scene.id === selectedSceneId;
            if (readOnly) {
              return (
                <li key={scene.id}>
                  <SceneCard
                    scene={scene}
                    title={title}
                    selected={selected}
                    tooltip="Open the scene"
                    hasPopup
                    onClick={() => onExpand(scene)}
                  />
                </li>
              );
            }
            return (
              <li key={scene.id}>
                <SceneCard
                  scene={scene}
                  title={title}
                  selected={selected}
                  status={selected ? "Editing" : undefined}
                  tooltip="Click to edit · Double-click to expand"
                  hasPopup
                  onClick={() => onSelect(scene)}
                  onDoubleClick={() => onExpand(scene)}
                  onKeyActivate={() => (selected ? onExpand(scene) : onSelect(scene))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
