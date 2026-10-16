import { useState } from "react";
import {
  displayScriptSceneText,
} from "@/entities/script-scene/model/capturedScene.js";
import { formatFilmTiming } from "@/entities/script-scene/model/filmTiming.js";
import { getStillThumbnail } from "@/entities/still/model/still.js";
import { ScenePage } from "@/features/scene-text-style/ui/ScenePage.jsx";
import { SceneTextStyleToggle } from "@/features/scene-text-style/ui/SceneTextStyleToggle.jsx";
import { groupScriptTagsByCategory } from "@server/domain/script-tags.js";
import { cx } from "@/shared/lib/cx.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { formatMomentToHms } from "@/shared/lib/time.js";
import { Button } from "@/shared/ui/Button.jsx";
import { ScreenplayView } from "@/shared/ui/ScreenplayView.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { useSceneViewer } from "../model/useSceneViewer.js";
import { SceneDetailModal, SceneModalPaper } from "./SceneDetailModal.jsx";
import styles from "./SceneDetailModal.module.css";

// Why a tab is unavailable; shown as its tooltip and in an empty stage.
const SCRIPT_UNAVAILABLE = {
  loading: "Loading this script's scenes…",
  "no-script": "This film has no script yet",
  failed: "Couldn't load this script's scenes",
  none: "No captured scene covers this still",
};

const STILL_UNAVAILABLE = {
  loading: "Loading this film's stills…",
  failed: "Couldn't load this film's stills",
  none: "No film still falls inside this scene's timing",
};

// Footer note on the still tab when there's no scene to take tags from.
const STILL_SCENE_NOTES = {
  loading: "Finding the captured scene for this still…",
  "no-script": "Upload the script to link stills to scenes.",
  failed: "Couldn't load this script's scenes.",
  none: "No captured scene covers this still yet.",
};

/**
 * The site's one expanded scene viewer, shared by Script Search, the film
 * page, and the script viewer. It shows a moment of a film as a captured
 * scene's script or as a film still, with arrows on both tabs; the tab not
 * being stepped follows along (see sceneViewerCursor.js).
 *
 * `initial` selects the opening scene or still; `source` supplies owned lists.
 * - `renderActions({ view, scene, still })` adds page-specific footer buttons;
 *   `renderStillTools(still)` renders above the still, e.g. an edit form.
 */
export function SceneViewerModal({
  initial,
  source,
  onClose,
  onSelectTag,
  onOpenStill,
  onOpenScene,
  openSceneLabel = "Open scene in script",
  renderActions,
  renderStillTools,
}) {
  const current = useSceneViewer({ initial, source });
  const { scene, still } = current;
  const showStill = current.view === "still";
  // Counts picks of a view, so the chosen view's icon comes alive each time it's picked.
  const [viewPicks, setViewPicks] = useState(0);

  function pickView(view) {
    setViewPicks((count) => count + 1);
    current.setView(view);
  }

  let meta = "Script";
  if (showStill) {
    meta = still ? `Film still · ${formatMomentToHms(still.time_seconds)}` : "Film still";
  } else if (scene) {
    meta = formatFilmTiming(scene);
  }

  return (
    <SceneDetailModal
      title={current.title}
      meta={meta}
      counter={current.counter}
      toolbar={
        <>
          <SegmentedControl
            label="Scene view"
            value={current.view}
            onChange={pickView}
            sliding
            options={[
              {
                value: "script",
                label: "Script",
                // The page in the visitor's style; picking the script types its lines.
                icon: <ScenePage key={`script-${viewPicks}`} height={14} typing={viewPicks > 0 && !showStill} />,
                disabled: !scene,
                title: scene ? undefined : SCRIPT_UNAVAILABLE[current.sceneStatus],
              },
              {
                value: "still",
                label: "Film still",
                // The scene's own still in a tiny frame; picking it develops like a print.
                icon: <StillFrameIcon key={`still-${viewPicks}`} still={still} developing={viewPicks > 0 && showStill} />,
                disabled: !still,
                title: still ? undefined : STILL_UNAVAILABLE[current.stillStatus],
              },
            ]}
          />
          {/* The page style only shows on the script, so it rests while a still is up. */}
          <SceneTextStyleToggle look="toolbar" disabled={current.view !== "script"} />
        </>
      }
      hasPrev={current.hasPrev}
      hasNext={current.hasNext}
      onStep={current.step}
      onClose={onClose}
      stageKey={showStill ? `still:${still?.id}` : `scene:${scene?.id}`}
      footer={
        scene ? (
          <SceneTags scene={scene} onSelectTag={onSelectTag} />
        ) : (
          <p className={styles.noTags}>{showStill ? STILL_SCENE_NOTES[current.sceneStatus] : ""}</p>
        )
      }
      actions={
        <>
          {renderActions?.({ view: current.view, scene, still })}
          {onOpenStill && still && (
            <Button onClick={() => onOpenStill(still, current.filmId)}>
              {!current.stillLeads ? "Open first still" : "Open on film page"}
            </Button>
          )}
          {onOpenScene && scene && (
            <Button variant="primary" onClick={() => onOpenScene(scene)}>
              {openSceneLabel}
            </Button>
          )}
        </>
      }
    >
      {showStill ? (
        still ? (
          <div className={styles.stillStage}>
            {renderStillTools?.(still)}
            <StillImage still={still} />
          </div>
        ) : (
          <p className={styles.stageMessage}>{STILL_UNAVAILABLE[current.stillStatus]}</p>
        )
      ) : scene ? (
        <SceneModalPaper>
          <ScreenplayView
            variant="reader"
            source={displayScriptSceneText(scene)}
            emptyText="No script text captured for this scene."
          />
        </SceneModalPaper>
      ) : (
        <p className={styles.stageMessage}>{SCRIPT_UNAVAILABLE[current.sceneStatus]}</p>
      )}
    </SceneDetailModal>
  );
}

/** The current still in a tiny frame, for the view switch. `developing` plays it in like a print. */
function StillFrameIcon({ still, developing }) {
  const thumbnail = getStillThumbnail(still);
  const url = useSignedMediaUrl(thumbnail.key, thumbnail.url);
  return (
    <span
      className={cx(styles.stillIcon, developing && styles.developing)}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}
      aria-hidden="true"
    />
  );
}

/** A film still filling the stage, at the same scale on every page. */
function StillImage({ still }) {
  const url = useSignedMediaUrl(still.image_key || null, still.image_url || null);
  if (!url) {
    return (
      <p className={styles.stageMessage}>
        {still.image_key || still.image_url ? "Loading still…" : "This still has no image."}
      </p>
    );
  }
  return (
    <img
      className={styles.stillImage}
      src={url}
      alt={`Film still at ${formatMomentToHms(still.time_seconds)}`}
    />
  );
}

/** The scene's tags grouped by category; tags link to Script Search when `onSelectTag` is given. */
function SceneTags({ scene, onSelectTag }) {
  const groups = groupScriptTagsByCategory(scene.tags);
  if (groups.length === 0) {
    return <p className={styles.noTags}>No tags on this scene yet.</p>;
  }

  return (
    <dl className={styles.tagGroups}>
      {groups.map((group) => (
        <div key={group.label} className={styles.tagGroup}>
          <dt>{group.label}</dt>
          <dd>
            {group.tags.map((tag, index) => (
              <span key={tag.value}>
                {onSelectTag ? (
                  <button
                    type="button"
                    className={styles.tagLink}
                    onClick={() => onSelectTag(tag.value)}
                    title={`Find scenes tagged ${tag.label}`}
                  >
                    {tag.label}
                  </button>
                ) : (
                  tag.label
                )}
                {index < group.tags.length - 1 && ", "}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
