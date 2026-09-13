import { useState } from "react";
import { displayScriptSceneText, formatScriptScenePages, getSceneFirstStill } from "@/entities/script-scene";
import { formatSecondsToHms } from "@/shared/lib/time";
import { ScreenplayView } from "@/shared/ui";
import {
  SceneDetailModal,
  SceneModalActions,
  SceneModalButton,
  SceneModalPaper,
  SceneModalStill,
  SceneModalTags,
  SceneModalViewToggle,
} from "@/widgets/scene-detail-modal";

/**
 * Expanded saved scene in the script viewer. Opens on the script; the scene's
 * first still can replace it in the same stage, and tags sit beneath.
 */
export function SavedSceneModal({
  scene,
  index,
  total,
  title,
  deleting,
  onStep,
  onClose,
  onOpenScene,
  onOpenFirstImage,
  onSelectTag,
  onDelete,
}) {
  const [view, setView] = useState("script");
  const firstStill = getSceneFirstStill(scene);
  const showStill = view === "still" && Boolean(firstStill);

  return (
    <SceneDetailModal
      title={title}
      meta={`${formatScriptScenePages(scene)} · ${formatSecondsToHms(scene.start_time_seconds)} – ${formatSecondsToHms(
        scene.end_time_seconds
      )}`}
      counter={`${index + 1} / ${total}`}
      toolbar={<SceneModalViewToggle value={view} onChange={setView} hasStill={Boolean(firstStill)} />}
      hasPrev={index > 0}
      hasNext={index < total - 1}
      onStep={onStep}
      onClose={onClose}
      stageKey={`${scene.id}:${showStill ? "still" : "script"}`}
      footer={
        <>
          <SceneModalTags scene={scene} onSelectTag={onSelectTag} />
          <SceneModalActions>
            <SceneModalButton variant="danger" disabled={deleting} onClick={() => onDelete(scene)}>
              {deleting ? "Deleting…" : "Delete"}
            </SceneModalButton>
            {firstStill && (
              <SceneModalButton onClick={() => onOpenFirstImage(scene)}>Open first still</SceneModalButton>
            )}
            <SceneModalButton variant="primary" onClick={() => onOpenScene(scene)}>
              Edit scene
            </SceneModalButton>
          </SceneModalActions>
        </>
      }
    >
      {showStill ? (
        <SceneModalStill scene={scene} />
      ) : (
        <SceneModalPaper>
          <ScreenplayView
            variant="reader"
            source={displayScriptSceneText(scene)}
            emptyText="No script text captured for this scene."
          />
        </SceneModalPaper>
      )}
    </SceneDetailModal>
  );
}
