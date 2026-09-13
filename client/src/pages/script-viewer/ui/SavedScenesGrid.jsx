import { SceneCard } from "@/entities/script-scene";
import styles from "./ScriptViewerPage.module.css";

export function SavedScenesGrid({ ref, scenes, selectedSceneId, title, onSelect, onExpand }) {
  return (
    <section ref={ref} className={styles.scenes} aria-labelledby="saved-scenes-title">
      <div className={styles.scenesHeader}>
        <h2 id="saved-scenes-title" className={styles.scenesTitle}>
          Scenes in this script
          <span className={styles.countPill}>{scenes.length}</span>
        </h2>
        <p className={styles.scenesHint}>Click a card to edit it · Double-click to expand</p>
      </div>

      {scenes.length === 0 ? (
        <p className={styles.emptyState}>
          No scenes yet. Right-click a line in the script to place a start anchor and begin one.
        </p>
      ) : (
        <ul className={styles.sceneGrid}>
          {scenes.map((scene) => {
            const selected = scene.id === selectedSceneId;
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
