import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  displayScriptSceneText,
  formatScriptScenePages,
  getScriptScenePageRange,
  getScriptTagLabel,
  groupScriptTagsByCategory,
  SceneCard,
} from "@/entities/script-scene";
import { api } from "@/shared/api";
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
import {
  buildFilterGroups,
  countSceneTags,
  SCENE_SORT_OPTIONS,
  sortScenes,
} from "../model/sceneBrowse.js";
import FilterSidebar from "./FilterSidebar.jsx";
import styles from "./ScriptSearchPage.module.css";

export default function ScriptSearchPage() {
  const nav = useNavigate();
  const [selectedTags, setSelectedTags] = useState([]);
  const [match, setMatch] = useState("all");
  const [sort, setSort] = useState("recent");
  const [response, setResponse] = useState({ key: null, rows: [], error: "" });
  // Unfiltered result set, used for the per-tag counts in the sidebar.
  const [catalog, setCatalog] = useState([]);
  const [activeSceneId, setActiveSceneId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Match mode only matters once tags are selected.
  const requestKey = selectedTags.length ? JSON.stringify([selectedTags, match]) : "all";
  const loading = response.key !== requestKey;

  useEffect(() => {
    let cancelled = false;
    api
      .searchScriptScenes({ tags: selectedTags, match })
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        setResponse({ key: requestKey, rows, error: "" });
        if (selectedTags.length === 0) setCatalog(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setResponse({ key: requestKey, rows: [], error: e.message || "Search failed" });
        }
      });
    return () => {
      cancelled = true;
    };
    // requestKey captures selectedTags and match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const results = useMemo(() => sortScenes(response.rows, sort), [response.rows, sort]);
  const tagCounts = useMemo(() => countSceneTags(catalog), [catalog]);
  const filterGroups = useMemo(
    () => buildFilterGroups(catalog, selectedTags),
    [catalog, selectedTags]
  );
  const titleCount = useMemo(() => new Set(results.map((row) => row.movie_id)).size, [results]);

  const activeIndex = results.findIndex((row) => row.id === activeSceneId);
  const activeScene = activeIndex >= 0 ? results[activeIndex] : null;

  function toggleTag(tag) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function stepScene(delta) {
    const next = results[activeIndex + delta];
    if (next) setActiveSceneId(next.id);
  }

  function openSceneInScript(scene) {
    const { pageStart } = getScriptScenePageRange(scene);
    const params = new URLSearchParams();
    params.set("sceneId", scene.id);
    params.set("page", String(pageStart));
    nav(`/movies/${scene.movie_id}/scripts/${scene.script_id}?${params.toString()}`);
  }

  function openFirstImageAnnotation(scene) {
    const annotationId = scene?.first_image_annotation?.id;
    if (!annotationId) return;

    const params = new URLSearchParams();
    params.set("annotationId", annotationId);
    nav(`/movies/${scene.movie_id}?${params.toString()}`);
  }

  const summary = response.key
    ? `Showing ${results.length} scene${results.length === 1 ? "" : "s"} from ${titleCount} title${
        titleCount === 1 ? "" : "s"
      }`
    : "Loading scenes…";

  return (
    <div className={styles.page}>
      <h1 className={styles.visuallyHidden}>Script Scene Search</h1>

      <FilterSidebar
        groups={filterGroups}
        tagCounts={tagCounts}
        selectedTags={selectedTags}
        match={match}
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onToggleTag={toggleTag}
        onMatchChange={setMatch}
        onClear={() => setSelectedTags([])}
      />

      <section className={styles.results} aria-busy={loading}>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.filtersButton}
            onClick={() => setFiltersOpen(true)}
          >
            Filters{selectedTags.length ? ` (${selectedTags.length})` : ""}
          </button>
          <p className={styles.resultCount} aria-live="polite">
            {summary}
          </p>
          <label className={styles.sortControl}>
            <span>Sort by:</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SCENE_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedTags.length > 0 && (
          <ul className={styles.activeFilters} aria-label="Active filters">
            {selectedTags.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  className={styles.activeChip}
                  onClick={() => toggleTag(tag)}
                  aria-label={`Remove ${getScriptTagLabel(tag)} filter`}
                >
                  {getScriptTagLabel(tag)}
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {response.error && (
          <div className={styles.error} role="alert">
            {response.error}
          </div>
        )}

        {results.length === 0 ? (
          !loading && (
            <p className={styles.emptyState}>No scene annotations matched your filters.</p>
          )
        ) : (
          <ul className={`${styles.grid} ${loading ? styles.gridLoading : ""}`}>
            {results.map((scene) => (
              <li key={scene.id}>
                <SceneCard scene={scene} hasPopup onClick={() => setActiveSceneId(scene.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {activeScene && (
        <SceneDetailModal
          title={activeScene.movie_title || "Unknown title"}
          meta={`${formatScriptScenePages(activeScene)} · ${formatSecondsToHms(
            activeScene.start_time_seconds
          )} – ${formatSecondsToHms(activeScene.end_time_seconds)}`}
          counter={`${activeIndex + 1} / ${results.length}`}
          hasPrev={activeIndex > 0}
          hasNext={activeIndex < results.length - 1}
          onStep={stepScene}
          onClose={() => setActiveSceneId(null)}
          stageKey={activeScene.id}
          footer={
            <>
              <SceneModalTagGroups groups={groupScriptTagsByCategory(activeScene.tags)} />
              <SceneModalActions>
                <SceneFirstImageThumb scene={activeScene} onOpen={openFirstImageAnnotation} />
                <SceneModalButton variant="primary" onClick={() => openSceneInScript(activeScene)}>
                  Open Scene In Script
                </SceneModalButton>
                <SceneModalButton
                  disabled={!activeScene.first_image_annotation?.id}
                  title={
                    activeScene.first_image_annotation?.id
                      ? `Open first image annotation at ${formatSecondsToHms(
                          activeScene.first_image_annotation.time_seconds
                        )}`
                      : "No image annotation falls inside this scene's timeframe."
                  }
                  onClick={() => openFirstImageAnnotation(activeScene)}
                >
                  Open First Image
                </SceneModalButton>
              </SceneModalActions>
            </>
          }
        >
          <SceneModalPaper>
            <ScreenplayView
              source={displayScriptSceneText(activeScene)}
              emptyText="No script text captured for this scene."
            />
          </SceneModalPaper>
        </SceneDetailModal>
      )}
    </div>
  );
}
