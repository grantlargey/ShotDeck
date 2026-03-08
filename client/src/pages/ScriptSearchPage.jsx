import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { SCRIPT_TAG_CATEGORIES } from "../constants/scriptTagCategories";
import { formatSecondsToHms } from "../utils/time";
import styles from "./ScriptSearchPage.module.css";

function safeTags(tags) {
  return Array.isArray(tags) ? tags.map(String) : [];
}

function displaySceneText(row) {
  if (typeof row?.formatted_selected_text === "string" && row.formatted_selected_text.trim()) {
    return row.formatted_selected_text;
  }
  if (typeof row?.raw_selected_text === "string" && row.raw_selected_text.trim()) {
    return row.raw_selected_text;
  }
  return row?.selected_text || "";
}

export default function ScriptSearchPage() {
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [match, setMatch] = useState("all");
  const [query, setQuery] = useState("");
  const [expandedById, setExpandedById] = useState({});

  async function runSearch() {
    setErr("");
    setLoading(true);
    try {
      const data = await api.searchScriptScenes({
        tags: selectedTags,
        match,
        q: query,
      });
      setResults(Array.isArray(data) ? data : []);
      setExpandedById({});
    } catch (e) {
      setErr(e.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleTag(tag) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function toggleExpanded(sceneId) {
    setExpandedById((prev) => ({
      ...prev,
      [sceneId]: !prev[sceneId],
    }));
  }

  const subtitle = useMemo(() => {
    const parts = [];

    if (query.trim()) parts.push(`query "${query.trim()}"`);
    if (selectedTags.length > 0) {
      parts.push(
        `${selectedTags.length} tag${selectedTags.length === 1 ? "" : "s"} (${match.toUpperCase()})`
      );
    }

    if (parts.length === 0) return "Showing all saved script scenes.";
    return `Filtering by ${parts.join(" + ")}.`;
  }, [match, query, selectedTags]);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Script Scene Search</h1>
        <button type="button" className={styles.backBtn} onClick={() => nav("/movies")}>
          Back To Archive
        </button>
      </div>

      {err && <div className={styles.error}>{err}</div>}

      <section className={styles.filterPanel}>
        <div className={styles.filterMeta}>
          <p className={styles.subtitle}>{subtitle}</p>
          <label className={styles.searchLabel}>
            Search text/labels/summary
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.searchInput}
              placeholder="Fight scene, rooftop, argument..."
            />
          </label>
          <div className={styles.matchRow}>
            <label>
              <input type="radio" checked={match === "all"} onChange={() => setMatch("all")} />
              Match all selected tags
            </label>
            <label>
              <input type="radio" checked={match === "any"} onChange={() => setMatch("any")} />
              Match any selected tag
            </label>
          </div>
        </div>

        {SCRIPT_TAG_CATEGORIES.map((group) => (
          <fieldset key={group.key} className={styles.group}>
            <legend>{group.label}</legend>
            <div className={styles.chips}>
              {group.tags.map((tag) => {
                const selected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`${styles.chip} ${selected ? styles.chipSelected : ""}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className={styles.filterActions}>
          <button type="button" className={styles.searchBtn} onClick={runSearch}>
            {loading ? "Searching..." : "Search"}
          </button>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => {
              setSelectedTags([]);
              setQuery("");
            }}
          >
            Clear Filters
          </button>
        </div>
      </section>

      <section className={styles.results}>
        {loading ? (
          <p>Loading results...</p>
        ) : results.length === 0 ? (
          <p>No scene annotations matched your filters.</p>
        ) : (
          <ul className={styles.resultsList}>
            {results.map((row) => {
              const tags = safeTags(row.tags);
              const pageStart = Number(row.page_start || row.page_end || 1);
              const pageEnd = Number(row.page_end || row.page_start || pageStart);
              const label = row.scene_label || "";
              const summary = row.scene_summary || "";
              const isExpanded = Boolean(expandedById[row.id]);
              const previewText = summary || displaySceneText(row);

              return (
                <li
                  key={row.id}
                  className={`${styles.resultItem} ${isExpanded ? styles.resultItemExpanded : ""}`}
                >
                  <button
                    type="button"
                    className={styles.resultPreviewBtn}
                    onClick={() => toggleExpanded(row.id)}
                  >
                    <div className={styles.previewTop}>
                      <h3 className={styles.resultTitle}>{row.movie_title || "Unknown Movie"}</h3>
                      <span className={styles.expandHint}>{isExpanded ? "Collapse" : "Expand"}</span>
                    </div>
                    <p className={styles.resultMeta}>
                      {formatSecondsToHms(row.start_time_seconds)} - {formatSecondsToHms(row.end_time_seconds)} | Page{" "}
                      {pageStart}
                      {pageEnd > pageStart ? `-${pageEnd}` : ""}
                    </p>
                    {label && <p className={styles.resultLabel}>{label}</p>}
                    <p className={styles.previewText}>{previewText}</p>
                    {tags.length > 0 && (
                      <div className={styles.resultTags}>
                        {tags.slice(0, 6).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </button>

                  {isExpanded && (
                    <div className={styles.expandedBody}>
                      {summary && <p className={styles.resultSummary}>{summary}</p>}
                      <p className={styles.resultText}>{displaySceneText(row)}</p>
                      <button
                        type="button"
                        className={styles.openBtn}
                        onClick={() => {
                          const params = new URLSearchParams();
                          params.set("sceneId", row.id);
                          params.set("page", String(pageStart));
                          nav(`/movies/${row.movie_id}/scripts/${row.script_id}?${params.toString()}`);
                        }}
                      >
                        Open Scene In Script
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
