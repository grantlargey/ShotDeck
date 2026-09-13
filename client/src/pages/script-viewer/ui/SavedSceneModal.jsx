import {
  displayScriptSceneText,
  formatScriptScenePages,
  groupScriptTagsByCategory,
} from "@/entities/script-scene";
import { formatSecondsToHms } from "@/shared/lib/time";
import { ScreenplayView } from "@/shared/ui";
import {
  SceneDetailModal,
  SceneFirstImageThumb,
  SceneModalActions,
  SceneModalButton,
  SceneModalPaper,
  SceneModalTagGroups,
} from "@/widgets/scene-detail-modal";

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
  onDelete,
}) {
  const firstImage = scene.first_image_annotation;

  return (
    <SceneDetailModal
      title={title}
      meta={`${formatScriptScenePages(scene)} · ${formatSecondsToHms(scene.start_time_seconds)} – ${formatSecondsToHms(
        scene.end_time_seconds
      )}`}
      counter={`${index + 1} / ${total}`}
      hasPrev={index > 0}
      hasNext={index < total - 1}
      onStep={onStep}
      onClose={onClose}
      stageKey={scene.id}
      footer={
        <>
          <SceneModalTagGroups groups={groupScriptTagsByCategory(scene.tags)} />
          <SceneModalActions>
            <SceneFirstImageThumb scene={scene} onOpen={onOpenFirstImage} />
            <SceneModalButton variant="danger" disabled={deleting} onClick={() => onDelete(scene)}>
              {deleting ? "Deleting…" : "Delete"}
            </SceneModalButton>
            <SceneModalButton
              disabled={!firstImage?.id}
              title={
                firstImage?.id
                  ? `Open first image annotation at ${formatSecondsToHms(firstImage.time_seconds)}`
                  : "No image annotation falls inside this scene's timeframe."
              }
              onClick={() => onOpenFirstImage(scene)}
            >
              Open First Image
            </SceneModalButton>
            <SceneModalButton variant="primary" onClick={() => onOpenScene(scene)}>
              Open Scene
            </SceneModalButton>
          </SceneModalActions>
        </>
      }
    >
      <SceneModalPaper>
        <ScreenplayView
          source={displayScriptSceneText(scene)}
          emptyText="No script text captured for this scene."
        />
      </SceneModalPaper>
    </SceneDetailModal>
  );
}
