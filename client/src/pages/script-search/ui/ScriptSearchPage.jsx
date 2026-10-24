import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getStillFilmPath } from "@/entities/still/model/still.js";
import { getSceneScriptPath } from "@/entities/script-scene/model/capturedScene.js";
import { SceneCard } from "@/entities/script-scene/ui/SceneCard.jsx";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { SceneBrowser } from "@/widgets/scene-browser/ui/SceneBrowser.jsx";
import { SceneViewerModal } from "@/widgets/scene-detail-modal/ui/SceneViewerModal.jsx";
import styles from "./ScriptSearchPage.module.css";

export default function ScriptSearchPage() {
  useDocumentTitle("Script Search");
  const nav = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [viewer, setViewer] = useState(null);

  function showScenesWithTag(tag) {
    setViewer(null);
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.delete("tag");
      params.append("tag", tag);
      return params;
    }, { replace: true });
  }

  return (
    <>
      <h1 className={styles.visuallyHidden}>Script Scene Search</h1>
      <SceneBrowser
        renderScene={(scene, display, results) => (
          <SceneCard
            scene={scene}
            {...display}
            hasPopup
            onClick={() => setViewer({ sceneId: scene.id, scenes: results })}
          />
        )}
      />
      {viewer && (
        <SceneViewerModal
          key={viewer.sceneId}
          initial={{ sceneId: viewer.sceneId }}
          source={{ scenes: viewer.scenes }}
          onClose={() => setViewer(null)}
          onSelectTag={showScenesWithTag}
          onOpenStill={(still, filmId) => nav(getStillFilmPath(filmId, still.id))}
          onOpenScene={(scene) => nav(getSceneScriptPath(scene))}
        />
      )}
    </>
  );
}
