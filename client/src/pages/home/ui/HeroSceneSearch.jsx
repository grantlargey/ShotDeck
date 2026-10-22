import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchHandOffState } from "@/features/scene-search/model/searchHandOff.js";
import { SceneSearchField } from "@/features/scene-search/ui/SceneSearchField.jsx";
import { getSemanticSearchStatus } from "@/shared/api/scriptScenes.js";
import { cx } from "@/shared/lib/cx.js";
import styles from "./HeroSceneSearch.module.css";

/**
 * The home hero's search: the scene search field on a pane of glass, open all
 * the time, so example descriptions type themselves out until you type. A
 * search opens Script Search on the description, handing over where the field
 * sat so the search's tag flies in from it.
 */
export function HeroSceneSearch() {
  const navigate = useNavigate();
  const fieldRef = useRef(null);
  const [value, setValue] = useState("");
  // What the API reports about semantic search; until it's configured the field can't be used.
  const [semanticStatus, setSemanticStatus] = useState(null);
  const unavailable = semanticStatus !== null && !semanticStatus?.configured;

  useEffect(() => {
    let cancelled = false;
    getSemanticSearchStatus()
      .then((data) => {
        if (!cancelled) setSemanticStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function search(description) {
    if (!description) return;
    navigate(`/script-search?${new URLSearchParams({ q: description })}`, {
      state: searchHandOffState(fieldRef.current?.getBoundingClientRect()),
    });
  }

  return (
    <div className={styles.slot} role="search">
      <SceneSearchField
        variant="hero"
        className={cx(styles.glass, unavailable && styles.unavailable)}
        title={unavailable ? "Semantic search isn't available yet" : undefined}
        value={value}
        open={!unavailable}
        disabled={unavailable}
        fieldRef={fieldRef}
        onChange={setValue}
        onSubmit={search}
      />
    </div>
  );
}
