import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getStillProjectPath } from "@/entities/annotation";
import {
  getSceneScriptPath,
  getScriptTagLabel,
  SceneCard,
  SceneCardSkeleton,
} from "@/entities/script-scene";
import { searchScriptScenes } from "@/shared/api/scriptScenes.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import {
  Button,
  Callout,
  Chip,
  EmptyState,
  ScriptIcon,
  SegmentedControl,
  Select,
  SplitViewIcon,
} from "@/shared/ui";
import { SceneViewerModal } from "@/widgets/scene-detail-modal";
import {
  buildFilterGroups,
  countSceneTags,
  SCENE_SORT_OPTIONS,
  sortScenes,
} from "../model/sceneBrowse.js";
import FilterSidebar from "./FilterSidebar.jsx";
import styles from "./ScriptSearchPage.module.css";

const SKELETON_CARDS = 6;
// Joins tag values into one stable string for memo dependencies.
const TAG_SEPARATOR = " ";

const CARD_LAYOUT_OPTIONS = [
  { value: "script", label: "Script only", title: "Script only", icon: <ScriptIcon size={16} />, hideLabel: true },
  {
    value: "split",
    label: "Film still and script",
    title: "Film still and script",
    icon: <SplitViewIcon size={16} />,
    hideLabel: true,
  },
];

export default function ScriptSearchPage() {
  useDocumentTitle("Script Search");
  const nav = useNavigate();
  // Selected tags (?tag=…) and the card view (?preview=stills) live in the URL so views can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const tagKey = searchParams.getAll("tag").join(TAG_SEPARATOR);
  const selectedTags = useMemo(() => (tagKey ? tagKey.split(TAG_SEPARATOR) : []), [tagKey]);
  const cardLayout = searchParams.get("preview") === "stills" ? "split" : "script";
  const [match, setMatch] = useState("all");
  const [sort, setSort] = useState("recent");
  const [response, setResponse] = useState({ key: null, rows: [], error: "" });
  // Unfiltered result set, used for the per-tag counts in the sidebar.
  const [catalog, setCatalog] = useState([]);
  // The scene the viewer opened on; it opens on the script, with the still one click away.
  const [openSceneId, setOpenSceneId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openedWithTagsRef = useRef(selectedTags.length > 0);

  // Match mode only matters once tags are selected.
  const requestKey = selectedTags.length ? JSON.stringify([selectedTags, match]) : "all";
  const loading = response.key !== requestKey;

  useEffect(() => {
    let cancelled = false;
    searchScriptScenes({ tags: selectedTags, match })
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        setResponse({ key: requestKey, rows, error: "" });
        if (selectedTags.length === 0) setCatalog(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setResponse({ key: requestKey, rows: [], error: getErrorMessage(e, "Search failed.") });
        }
      });
    return () => {
      cancelled = true;
    };
    // requestKey captures selectedTags and match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // A linked, pre-filtered view still needs the unfiltered catalog for tag counts.
  useEffect(() => {
    if (!openedWithTagsRef.current) return;
    searchScriptScenes({ tags: [], match: "all" })
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const results = useMemo(() => sortScenes(response.rows, sort), [response.rows, sort]);
  const tagCounts = useMemo(() => countSceneTags(catalog), [catalog]);
  const filterGroups = useMemo(
    () => buildFilterGroups(catalog, selectedTags),
    [catalog, selectedTags]
  );
  const titleCount = useMemo(() => new Set(results.map((row) => row.movie_id)).size, [results]);

  function updateParams(update) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        update(params);
        return params;
      },
      { replace: true }
    );
  }

  function setSelectedTags(nextTags) {
    updateParams((params) => {
      params.delete("tag");
      nextTags.forEach((tag) => params.append("tag", tag));
    });
  }

  function setCardLayout(nextLayout) {
    updateParams((params) => {
      if (nextLayout === "split") params.set("preview", "stills");
      else params.delete("preview");
    });
  }

  function toggleTag(tag) {
    setSelectedTags(selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag]);
  }

  /** From a scene's tags: show every scene with just this tag. */
  function showScenesWithTag(tag) {
    setOpenSceneId(null);
    setSelectedTags([tag]);
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
          <Button size="sm" className={styles.filtersButton} onClick={() => setFiltersOpen(true)}>
            Filters{selectedTags.length ? ` (${selectedTags.length})` : ""}
          </Button>
          <p className={styles.resultCount} aria-live="polite">
            {summary}
          </p>
          <div className={styles.toolbarControls}>
            <SegmentedControl
              label="Card preview"
              options={CARD_LAYOUT_OPTIONS}
              value={cardLayout}
              onChange={setCardLayout}
            />
            <label className={styles.sortControl}>
              <span>Sort by</span>
              <Select className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value)}>
                {SCENE_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>

        {selectedTags.length > 0 && (
          <ul className={styles.activeFilters} aria-label="Active filters">
            {selectedTags.map((tag) => (
              <li key={tag}>
                <Chip onRemove={() => toggleTag(tag)} removeLabel={`Remove ${getScriptTagLabel(tag)} filter`}>
                  {getScriptTagLabel(tag)}
                </Chip>
              </li>
            ))}
          </ul>
        )}

        {response.error && (
          <Callout tone="error" className={styles.notice}>
            {response.error}
          </Callout>
        )}

        {results.length === 0 ? (
          loading ? (
            <ul className={styles.grid} aria-hidden="true">
              {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                <li key={index}>
                  <SceneCardSkeleton layout={cardLayout} />
                </li>
              ))}
            </ul>
          ) : (
            !response.error && (
              <EmptyState
                title={selectedTags.length ? "No scenes match these filters" : "No scene annotations yet"}
              >
                {selectedTags.length
                  ? "Try removing a filter or switching to Match any."
                  : "Scenes you capture in the script viewer show up here."}
              </EmptyState>
            )
          )
        ) : (
          <ul className={`${styles.grid} ${loading ? styles.gridLoading : ""}`}>
            {results.map((scene) => (
              <li key={scene.id}>
                <SceneCard scene={scene} layout={cardLayout} hasPopup onClick={() => setOpenSceneId(scene.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {openSceneId && (
        <SceneViewerModal
          key={openSceneId}
          initialView="script"
          initialSceneId={openSceneId}
          scenes={results}
          onClose={() => setOpenSceneId(null)}
          onSelectTag={showScenesWithTag}
          onOpenStill={(still, movieId) => nav(getStillProjectPath(movieId, still.id))}
          onOpenScene={(scene) => nav(getSceneScriptPath(scene))}
        />
      )}
    </div>
  );
}
