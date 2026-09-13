/** The first image annotation inside a scene's timing, when it has an image. */
export function getSceneFirstStill(scene) {
  return scene?.first_image_annotation?.image_key ? scene.first_image_annotation : null;
}
