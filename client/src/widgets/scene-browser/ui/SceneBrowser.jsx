import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";
import { getStillThumbnail } from "@/entities/still/model/still.js";
import { planStillMotion } from "@/entities/script-scene/model/stillMotion.js";
import { getScriptTagLabel } from "@server/domain/script-tags.js";
import { SceneCardSkeleton } from "@/entities/script-scene/ui/SceneCard.jsx";
import { getHandedOverSearchBox } from "@/features/scene-search/model/searchHandOff.js";
import { SceneTextStyleToggle } from "@/features/scene-text-style/ui/SceneTextStyleToggle.jsx";
import {
  getSemanticSearchStatus,
  searchScriptScenes,
  searchScriptScenesSemantically,
} from "@/shared/api/scriptScenes.js";
import { cx } from "@/shared/lib/cx.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { Chip } from "@/shared/ui/Chip.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import { buildFilterGroups, countSceneTags, filterSceneTags } from "../model/sceneBrowse.js";
import { sweepDelays } from "../model/stillSweep.js";
import { CardLayoutSwitch } from "./CardLayoutSwitch.jsx";
import FilterSidebar from "./FilterSidebar.jsx";
import { SceneSearchTile } from "./SceneSearchTile.jsx";
import { SearchTag } from "./SearchTag.jsx";
import styles from "./SceneBrowser.module.css";

const SKELETON_CARDS = 6;
const SEMANTIC_RESULT_LIMIT = 24;
// Joins tag values into one stable string for memo dependencies.
const TAG_SEPARATOR = " ";

/**
 * Search, tag filters and card display for the library or one script.
 * `scope` supplies { scriptId, scenes } from the viewer's live collection.
 * Tag browsing uses that collection; description search scopes both server
 * retrievers before ranking. `renderScene(scene, display, results)` lets each
 * page keep its own card interactions, with the same display and motion.
 */
export function SceneBrowser({ scope, title = "Scenes", headingId, instruction, emptyState, renderScene }) {
  const scriptId = scope?.scriptId;
  const scopedScenes = scope?.scenes;
  const location = useLocation();
  const navigationType = useNavigationType();
  // Selected tags (?tag=…) and the card view (?preview=stills) live in the URL so views can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  // Router updates can be deferred while a large scene grid renders. Keep
  // pending edits together so a quick second control does not restore a query
  // or filter that the first control just cleared. Back/Forward still wins.
  const paramsRef = useRef(searchParams);
  useLayoutEffect(() => {
    paramsRef.current = searchParams;
  }, [searchParams]);
  const tagKey = searchParams.getAll("tag").join(TAG_SEPARATOR);
  const selectedTags = useMemo(() => (tagKey ? tagKey.split(TAG_SEPARATOR) : []), [tagKey]);
  const chosenLayout = searchParams.get("preview") === "stills" ? "split" : "script";
  // The stills sweeping in or away while the layout changes. The cards show
  // stills for the whole motion: going in, from its first frame, a moment before
  // the URL catches up; going away, until they've gone, though the switch
  // already shows the new choice.
  const [stillMotion, setStillMotion] = useState(null);
  const cardLayout = stillMotion ? "split" : chosenLayout;
  const reducedMotion = usePrefersReducedMotion();
  const gridRef = useRef(null);
  // The semantic query lives in the URL too (?q=…), so a ranked view can be linked to.
  const committedQuery = searchParams.get("q") || "";
  const query = committedQuery.trim();
  const [draftQuery, setDraftQuery] = useState(committedQuery);
  const searchFieldRef = useRef(null);
  const searchInputRef = useRef(null);
  const [searchFocused, setSearchFocused] = useState(false);
  // Where the search field was when a description was searched, for its tag to fly in from.
  // A search the home page hands over flies in from the home page's field, on arrival only:
  // Back, Forward and a reload return to the page as it was left.
  const [tagFlyFrom, setTagFlyFrom] = useState(() =>
    !scope && navigationType === "PUSH" && query ? getHandedOverSearchBox(location.state) : null
  );
  const clearTagFlyFrom = useCallback(() => setTagFlyFrom(null), []);
  const match = searchParams.get("match") === "any" ? "any" : "all";
  const [response, setResponse] = useState({ key: null, rows: [], error: "" });
  // Unfiltered result set, used for the per-tag counts in the sidebar.
  const [loadedCatalog, setCatalog] = useState([]);
  const catalog = scopedScenes ?? loadedCatalog;
  const [filtersOpen, setFiltersOpen] = useState(false);
  // What the API reports about semantic search, including whether it is configured.
  const [semanticStatus, setSemanticStatus] = useState(null);
  const openedWithFiltersRef = useRef(selectedTags.length > 0 || Boolean(query));

  useEffect(() => {
    setDraftQuery(committedQuery);
  }, [committedQuery]);

  // Match mode only matters once tags are selected; a query replaces tag browsing with ranking.
  const requestKey = JSON.stringify([scriptId, query, selectedTags, match]);
  const localBrowsing = scopedScenes !== undefined && !query;
  const loading = !localBrowsing && (response.key !== requestKey || response.source !== scopedScenes);

  useEffect(() => {
    if (scopedScenes !== undefined && !query) return undefined;
    let cancelled = false;
    const request = query
      ? searchScriptScenesSemantically({ query, tags: selectedTags, match, limit: SEMANTIC_RESULT_LIMIT, scriptId })
      : searchScriptScenes({ tags: selectedTags, match });
    request
      .then((data) => {
        if (cancelled) return;
        if (query) {
          const rows = Array.isArray(data?.scenes) ? data.scenes : [];
          setResponse({ key: requestKey, rows, source: scopedScenes, error: "" });
        } else {
          const rows = Array.isArray(data) ? data : [];
          setResponse({ key: requestKey, rows, error: "" });
          if (selectedTags.length === 0) setCatalog(rows);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setResponse({ key: requestKey, rows: [], source: scopedScenes, error: getErrorMessage(e, "Search failed.") });
        }
      });
    return () => {
      cancelled = true;
    };
    // requestKey captures scriptId, query, selectedTags and match. A save or
    // deletion changes scopedScenes and refreshes an active description search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, scopedScenes]);

  // Whether semantic search is configured, which decides if the search box can be used.
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

  // A linked, pre-filtered or pre-searched view still needs the unfiltered catalog for tag counts.
  useEffect(() => {
    if (scriptId || !openedWithFiltersRef.current) return;
    searchScriptScenes({ tags: [], match: "all" })
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [scriptId]);

  // The API returns scenes in film title then film time order.
  const results = useMemo(() => {
    if (scopedScenes === undefined) return response.rows;
    if (!query) return filterSceneTags(scopedScenes, selectedTags, match);
    // Preserve ranking while taking text, tags and stills from the live
    // collection. Deleted scenes and records from another script cannot appear.
    const byId = new Map(scopedScenes.map((scene) => [scene.id, scene]));
    return filterSceneTags(response.rows.flatMap((scene) => byId.has(scene.id) ? [byId.get(scene.id)] : []), selectedTags, match);
  }, [scopedScenes, query, selectedTags, match, response.rows]);
  const error = localBrowsing ? "" : response.error;
  const ready = localBrowsing || Boolean(response.key);
  // A real still from the results for the card switch's little split card.
  const sampleStill = getStillThumbnail(results.find((scene) => scene.first_image_annotation)?.first_image_annotation);
  const sampleStillUrl = useSignedMediaUrl(sampleStill.key, sampleStill.url);

  useEffect(() => {
    if (!stillMotion) return undefined;
    const timer = setTimeout(() => setStillMotion(null), stillMotion.duration);
    return () => clearTimeout(timer);
  }, [stillMotion]);
  const tagCounts = useMemo(() => countSceneTags(catalog), [catalog]);
  const filterGroups = buildFilterGroups();
  const titleCount = useMemo(() => new Set(results.map((row) => row.movie_id)).size, [results]);
  const semanticConfigured = Boolean(semanticStatus?.configured);

  function updateParams(update) {
    const params = new URLSearchParams(paramsRef.current);
    update(params);
    paramsRef.current = params;
    setSearchParams(params, { replace: true });
  }

  function setSelectedTags(nextTags) {
    updateParams((params) => {
      params.delete("tag");
      nextTags.forEach((tag) => params.append("tag", tag));
    });
  }

  function setCardLayout(nextLayout) {
    if (nextLayout === chosenLayout) return;
    if (!reducedMotion && gridRef.current) {
      const phase = nextLayout === "split" ? "in" : "out";
      const edges = [...gridRef.current.children].map((item) => item.getBoundingClientRect());
      setStillMotion(planStillMotion(phase, sweepDelays(phase, edges)));
    }
    updateParams((params) => {
      if (nextLayout === "split") params.set("preview", "stills");
      else params.delete("preview");
    });
  }

  function toggleTag(tag) {
    updateParams((params) => {
      const tags = params.getAll("tag");
      const next = tags.includes(tag) ? tags.filter((value) => value !== tag) : [...tags, tag];
      params.delete("tag");
      next.forEach((value) => params.append("tag", value));
    });
  }

  function setMatch(next) {
    updateParams((params) => {
      if (next === "any") params.set("match", next);
      else params.delete("match");
    });
  }

  /** Commit the description to the URL, which the result effect follows; a new one's tag flies in from the field. */
  function submitSearch(text) {
    const nextQuery = text.trim();
    if (nextQuery && nextQuery !== query) setTagFlyFrom(searchFieldRef.current?.getBoundingClientRect() ?? null);
    setDraftQuery(nextQuery);
    updateParams((params) => {
      if (nextQuery) params.set("q", nextQuery);
      else params.delete("q");
    });
  }

  function clearSearch() {
    setDraftQuery("");
    updateParams((params) => params.delete("q"));
  }

  /** From the search's tag: reopen the field on its description, caret at the end. */
  function editSearch() {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  const summary = loading && query
    ? "Searching scenes…"
    : ready
    ? query
      ? `${results.length} scene${results.length === 1 ? "" : "s"} matching your description`
      : scriptId
        ? `Showing ${results.length} of ${catalog.length} captured scenes in this script`
        : `Showing ${results.length} scene${results.length === 1 ? "" : "s"} from ${titleCount} title${
          titleCount === 1 ? "" : "s"
        }`
    : "Loading scenes…";

  return (
    <div className={cx(styles.page, scope && styles.scoped)}>
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
        {semanticStatus && !semanticConfigured && (
          <Callout tone="info" className={styles.notice}>
            Description search is currently unavailable. You can still filter scenes by tag.
          </Callout>
        )}

        <SectionHeading
          id={headingId}
          className={styles.toolbar}
          actionsClassName={styles.toolbarActions}
          title={title}
          description={instruction}
          count={ready ? results.length : undefined}
          badge={
            ready && !scope && (
              <span className={styles.headingNote}>
                from {titleCount} title{titleCount === 1 ? "" : "s"}
              </span>
            )
          }
          actions={
            <>
              <Button size="sm" className={styles.filtersButton} onClick={() => setFiltersOpen(true)}>
                Filters{selectedTags.length ? ` (${selectedTags.length})` : ""}
              </Button>
              <SceneSearchTile
                value={draftQuery}
                query={query}
                disabled={semanticStatus !== null && !semanticConfigured}
                fieldRef={searchFieldRef}
                inputRef={searchInputRef}
                onChange={setDraftQuery}
                onSubmit={submitSearch}
                onFocusChange={setSearchFocused}
              />
              <CardLayoutSwitch value={chosenLayout} onChange={setCardLayout} stillUrl={sampleStillUrl} />
              <SceneTextStyleToggle look="toolbar" />
            </>
          }
        />
        <p className={styles.visuallyHidden} aria-live="polite">
          {summary}
        </p>

        {(query || selectedTags.length > 0) && (
          <ul className={styles.activeFilters} aria-label="Active filters">
            {query && (
              <li className={styles.searchTagItem}>
                <SearchTag
                  query={query}
                  searching={loading}
                  editing={searchFocused}
                  flyFrom={tagFlyFrom}
                  onFlown={clearTagFlyFrom}
                  onEdit={editSearch}
                  onClear={clearSearch}
                />
              </li>
            )}
            {selectedTags.map((tag) => (
              <li key={tag}>
                <Chip onRemove={() => toggleTag(tag)} removeLabel={`Remove ${getScriptTagLabel(tag)} filter`}>
                  {getScriptTagLabel(tag)}
                </Chip>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <Callout tone="error" className={styles.notice}>
            {error}
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
            !error && (!query && selectedTags.length === 0 && emptyState ? emptyState : (
                <EmptyState
                  title={
                    query
                      ? "No scenes match that description"
                      : selectedTags.length
                        ? "No scenes match these filters"
                        : "No scene annotations yet"
                  }
                >
                  {query
                    ? "Try describing the scene differently, or remove a tag filter."
                    : selectedTags.length
                      ? "Try removing a filter or switching to Match any."
                      : "Scenes you capture in the script viewer show up here."}
                </EmptyState>
              )
            )
          )
        ) : (
          <ul ref={gridRef} className={`${styles.grid} ${loading ? styles.gridLoading : ""}`}>
            {results.map((scene, index) => (
              <li key={scene.id}>
                {renderScene(scene, {
                  layout: cardLayout,
                  stillMotion: stillMotion && {
                    phase: stillMotion.phase,
                    delay: stillMotion.delays[index] ?? 0,
                    frameDelay: stillMotion.frameDelay,
                  },
                }, results)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
