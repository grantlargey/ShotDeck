import { useState } from "react";
import {
  displayScriptSceneText,
  formatScriptScenePages,
  groupScriptTagsByCategory,
} from "@/entities/script-scene";
import { useSignedMediaUrl } from "@/shared/lib/media";
import { formatSecondsToHms } from "@/shared/lib/time";
import { ImageIcon, ScreenplayView, ScriptIcon, SegmentedControl } from "@/shared/ui";
import {
  createSceneViewerCursor,
  resolveSceneViewerCursor,
  setSceneViewerView,
  stepSceneViewerToScene,
  stepSceneViewerToStill,
} from "../model/sceneViewerCursor.js";
import { useSceneViewerData } from "../model/useSceneViewerData.js";
import { SceneDetailModal, SceneModalActions, SceneModalButton, SceneModalPaper } from "./SceneDetailModal.jsx";
import styles from "./SceneDetailModal.module.css";

// Why a tab is unavailable; shown as its tooltip and in an empty stage.
const SCRIPT_UNAVAILABLE = {
  loading: "Loading this script's scenes…",
  "no-script": "This project has no script yet",
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

function formatSceneTiming(scene) {
  return `${formatSecondsToHms(scene.start_time_seconds)} – ${formatSecondsToHms(scene.end_time_seconds)}`;
}

/**
 * The site's one expanded scene viewer, shared by Script Search, the project
 * page, and the script viewer. It shows a moment of a film as a captured
 * scene's script or as a film still, with arrows on both tabs; the tab not
 * being stepped follows along (see sceneViewerCursor.js).
 *
 * - `scenes`: what the script tab's arrows walk (defaults to the script's scenes).
 * - `scriptScenes` / `stills`: the whole script and the film's stills, when the
 *   page already has them; otherwise they're fetched.
 * - `movie` / `scriptId`: the title and script to use when opening on a still.
 * - `renderActions({ view, scene, still })` adds page-specific footer buttons;
 *   `renderStillTools(still)` renders above the still, e.g. an edit form.
 */
export function SceneViewerModal({
  initialView = "script",
  initialSceneId = null,
  initialStillId = null,
  scenes,
  scriptScenes,
  stills,
  movie,
  scriptId = null,
  onClose,
  onSelectTag,
  onOpenStill,
  onOpenScene,
  openSceneLabel = "Open scene in script",
  renderActions,
  renderStillTools,
}) {
  const [cursor, setCursor] = useState(() =>
    createSceneViewerCursor({
      view: initialView,
      sceneId: initialSceneId,
      stillId: initialStillId,
      scenes: scenes || scriptScenes,
      stills,
      context: { movieId: movie?.id, scriptId, movieTitle: movie?.title },
    })
  );
  const { context } = cursor;
  const data = useSceneViewerData({
    movieId: context.movieId,
    scriptId: context.scriptId,
    stills: movie?.id && movie.id === context.movieId ? stills : undefined,
    scriptScenes: scriptId && scriptId === context.scriptId ? scriptScenes : undefined,
  });
  const stepScenes = scenes || data.scriptScenes || [];
  const current = resolveSceneViewerCursor(cursor, {
    scenes: stepScenes,
    scriptScenes: data.scriptScenes,
    stills: data.stills,
    scenesFailed: data.scenesFailed,
    stillsFailed: data.stillsFailed,
  });
  const { scene, still } = current;
  const showStill = cursor.view === "still";

  function step(delta) {
    if (showStill) {
      const target = delta < 0 ? current.prevStill : current.nextStill;
      if (target) {
        setCursor(stepSceneViewerToStill(cursor, target, { scenes: stepScenes, scriptScenes: data.scriptScenes }));
      }
      return;
    }
    const target = delta < 0 ? current.prevScene : current.nextScene;
    if (target) setCursor(stepSceneViewerToScene(cursor, target));
  }

  let meta = "Script";
  if (showStill) {
    meta = still
      ? [`Film still · ${formatSecondsToHms(still.time_seconds)}`, scene && formatScriptScenePages(scene)]
          .filter(Boolean)
          .join(" · ")
      : "Film still";
  } else if (scene) {
    meta = `${formatScriptScenePages(scene)} · ${formatSceneTiming(scene)}`;
  }

  let counter = null;
  if (showStill && current.stillIndex >= 0) counter = `${current.stillIndex + 1} / ${data.stills.length}`;
  if (!showStill && current.sceneIndex >= 0) counter = `${current.sceneIndex + 1} / ${stepScenes.length}`;

  return (
    <SceneDetailModal
      title={context.movieTitle || "Untitled project"}
      meta={meta}
      counter={counter}
      toolbar={
        <SegmentedControl
          label="Scene view"
          value={cursor.view}
          onChange={(view) => setCursor(setSceneViewerView(cursor, view))}
          options={[
            {
              value: "script",
              label: "Script",
              icon: <ScriptIcon size={14} />,
              disabled: !scene,
              title: scene ? undefined : SCRIPT_UNAVAILABLE[current.sceneStatus],
            },
            {
              value: "still",
              label: "Film still",
              icon: <ImageIcon size={14} />,
              disabled: !still,
              title: still ? undefined : STILL_UNAVAILABLE[current.stillStatus],
            },
          ]}
        />
      }
      hasPrev={Boolean(showStill ? current.prevStill : current.prevScene)}
      hasNext={Boolean(showStill ? current.nextStill : current.nextScene)}
      onStep={step}
      onClose={onClose}
      stageKey={showStill ? `still:${still?.id}` : `scene:${scene?.id}`}
      footer={
        <>
          {scene ? (
            <SceneTags scene={scene} onSelectTag={onSelectTag} />
          ) : (
            <p className={styles.noTags}>{showStill ? STILL_SCENE_NOTES[current.sceneStatus] : ""}</p>
          )}
          <SceneModalActions>
            {renderActions?.({ view: cursor.view, scene, still })}
            {onOpenStill && still && (
              <SceneModalButton onClick={() => onOpenStill(still, context.movieId)}>
                {cursor.lead === "scene" ? "Open first still" : "Open still in project"}
              </SceneModalButton>
            )}
            {onOpenScene && scene && (
              <SceneModalButton variant="primary" onClick={() => onOpenScene(scene)}>
                {openSceneLabel}
              </SceneModalButton>
            )}
          </SceneModalActions>
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
      alt={`Film still at ${formatSecondsToHms(still.time_seconds)}`}
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
