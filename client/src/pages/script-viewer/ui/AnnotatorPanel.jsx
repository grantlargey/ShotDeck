import { useState } from "react";
import { getScriptTagLabel, SCRIPT_TAG_CATEGORIES, SceneCard } from "@/entities/script-scene";
import { formatSecondsToHms } from "@/shared/lib/time";
import { undoShortcutLabel } from "../lib/platform.js";
import styles from "./AnnotatorPanel.module.css";

const ORIGIN_LABELS = {
  capture: "Captured from PDF",
  edited: "Edited",
  ai: "AI formatted",
  saved: "Saved",
};

function CrosshairIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" strokeLinecap="round" />
    </svg>
  );
}

function AnchorRow({ kind, anchor, onJump, onRemove }) {
  const label = kind === "start" ? "Start" : "End";
  const badgeClass = `${styles.anchorBadge} ${kind === "start" ? styles.anchorBadgeStart : styles.anchorBadgeEnd}`;

  if (!anchor) {
    return (
      <div className={`${styles.anchorRow} ${styles.anchorRowEmpty}`}>
        <span className={badgeClass}>{label[0]}</span>
        <span className={styles.anchorText}>
          <span className={styles.anchorLocation}>{label} anchor</span>
          <span className={styles.anchorPlaceholder}>Not placed</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`${styles.anchorRow} ${anchor.suggested ? styles.anchorRowSuggested : ""}`}>
      <span className={badgeClass}>{label[0]}</span>
      <span className={styles.anchorText}>
        <span className={styles.anchorLocation}>
          {anchor.suggested ? `Suggested ${label.toLowerCase()}` : label} · p. {anchor.page} · line {anchor.line + 1}
        </span>
        <span className={styles.anchorSnippet} title={anchor.text}>
          {anchor.text}
        </span>
      </span>
      <span className={styles.anchorActions}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => onJump(kind)}
          aria-label={`Scroll to the ${kind} anchor`}
          title="Scroll to anchor"
        >
          <CrosshairIcon />
        </button>
        {!anchor.suggested && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => onRemove(kind)}
            aria-label={`Remove the ${kind} anchor`}
            title="Remove anchor"
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

function TimeField({ label, value, onChange, onBlur }) {
  return (
    <label className={styles.field}>
      {label}
      <input
        type="text"
        className={styles.input}
        value={value}
        placeholder="00:00:00"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </label>
  );
}

function CaptureTab({
  anchors,
  anchorsSuggested,
  canUndo,
  indexStatus,
  onJumpToAnchor,
  onRemoveAnchor,
  onClearAnchors,
  onUndoAnchors,
  overlapScene,
  onEditOverlapScene,
  startTime,
  endTime,
  onTimeChange,
  onTimeBlur,
  capture,
  markdown,
  textOrigin,
  captureStale,
  legacyText,
  draftScene,
  movieTitle,
  proposal,
  onRecapture,
  onExpandDraft,
  onRequestAi,
  onReviewProposal,
  onDiscardProposal,
}) {
  const hasAnchors = Boolean(anchors.start || anchors.end);
  const hasText = Boolean(markdown.trim());

  return (
    <>
      <section className={styles.section} aria-labelledby="annotator-anchors">
        <div className={styles.sectionHeader}>
          <h3 id="annotator-anchors" className={styles.sectionTitle}>
            Anchors
          </h3>
          <div className={styles.sectionTools}>
            <button
              type="button"
              className={styles.toolButton}
              onClick={onUndoAnchors}
              disabled={!canUndo}
              title={`Undo anchor change (${undoShortcutLabel()})`}
            >
              Undo
            </button>
            <button type="button" className={styles.toolButton} onClick={onClearAnchors} disabled={!hasAnchors}>
              Clear
            </button>
          </div>
        </div>

        <div className={styles.anchorList}>
          <AnchorRow kind="start" anchor={anchors.start} onJump={onJumpToAnchor} onRemove={onRemoveAnchor} />
          <AnchorRow kind="end" anchor={anchors.end} onJump={onJumpToAnchor} onRemove={onRemoveAnchor} />
        </div>

        {anchorsSuggested ? (
          <p className={styles.hint}>
            Suggested from this scene&apos;s saved text. Move them with the right-click menu, or re-capture below to
            confirm them.
          </p>
        ) : (
          !(anchors.start && anchors.end) && (
            <p className={styles.hint}>
              Right-click a line in the script to place an anchor. Or hover a line and press <kbd>[</kbd> for the
              start or <kbd>]</kbd> for the end.
            </p>
          )
        )}

        {!indexStatus.complete && indexStatus.total > 0 && (
          <p className={styles.hint}>
            Indexing script text… {indexStatus.loaded} of {indexStatus.total} pages
          </p>
        )}

        {overlapScene && (
          <div className={`${styles.callout} ${styles.calloutWarn}`}>
            <span>
              This range overlaps the saved scene at {formatSecondsToHms(overlapScene.start_time_seconds)}.
            </span>
            <button type="button" className={styles.calloutAction} onClick={onEditOverlapScene}>
              Edit that scene
            </button>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="annotator-timing">
        <h3 id="annotator-timing" className={styles.sectionTitle}>
          Film timing
        </h3>
        <div className={styles.fieldRow}>
          <TimeField
            label="Start"
            value={startTime}
            onChange={(value) => onTimeChange("startTime", value)}
            onBlur={() => onTimeBlur("startTime")}
          />
          <TimeField
            label="End"
            value={endTime}
            onChange={(value) => onTimeChange("endTime", value)}
            onBlur={() => onTimeBlur("endTime")}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="annotator-text">
        <div className={styles.sectionHeader}>
          <h3 id="annotator-text" className={styles.sectionTitle}>
            Script text
          </h3>
          {hasText && (
            <span className={styles.originBadge} data-origin={textOrigin}>
              {ORIGIN_LABELS[textOrigin]}
            </span>
          )}
        </div>

        {captureStale && (
          <div className={`${styles.callout} ${styles.calloutInfo}`}>
            <span>
              {legacyText
                ? "This scene was saved before screenplay formatting."
                : "The anchors moved after this text was captured."}
            </span>
            <button type="button" className={styles.calloutAction} onClick={onRecapture}>
              Re-capture from anchors
            </button>
          </div>
        )}

        {hasText ? (
          <SceneCard
            scene={draftScene}
            title={movieTitle}
            tooltip="Double-click to expand and edit"
            onDoubleClick={onExpandDraft}
            onKeyActivate={onExpandDraft}
          />
        ) : (
          <p className={styles.emptyText}>
            {anchors.start && anchors.end
              ? "Capturing text between the anchors…"
              : "Place a start and an end anchor to capture this scene's text."}
          </p>
        )}

        {hasText && (
          <div className={styles.buttonRow}>
            <button type="button" className={styles.secondaryButton} onClick={onExpandDraft}>
              Expand &amp; edit
            </button>
            <button
              type="button"
              className={`${styles.secondaryButton} ${styles.aiButton}`}
              onClick={onRequestAi}
              disabled={proposal?.status === "loading"}
            >
              {proposal?.status === "loading" ? "Formatting…" : "Format with AI"}
            </button>
          </div>
        )}

        {proposal?.status === "ready" && (
          <div className={`${styles.callout} ${styles.calloutAi}`}>
            <span>An AI formatting proposal is ready. Nothing changes until you accept it.</span>
            <button type="button" className={styles.calloutAction} onClick={onReviewProposal}>
              Review
            </button>
          </div>
        )}

        {proposal?.status === "error" && (
          <div className={`${styles.callout} ${styles.calloutError}`} role="alert">
            <span>{proposal.error}</span>
            <button type="button" className={styles.calloutAction} onClick={onDiscardProposal}>
              Dismiss
            </button>
          </div>
        )}

        {capture && (
          <details className={styles.details}>
            <summary>Range details</summary>
            <dl className={styles.detailsList}>
              <dt>Pages</dt>
              <dd>
                {capture.pageStart === capture.pageEnd
                  ? capture.pageStart
                  : `${capture.pageStart}–${capture.pageEnd}`}
              </dd>
              <dt>Offsets</dt>
              <dd>
                {capture.startOffset === null
                  ? "Available once indexing finishes"
                  : `${capture.startOffset.toLocaleString()}–${capture.endOffset.toLocaleString()}`}
              </dd>
              <dt>Words</dt>
              <dd>{capture.wordCount.toLocaleString()}</dd>
            </dl>
            {capture.contextPrefix && (
              <p className={styles.context}>
                <span>Before</span>
                {capture.contextPrefix}
              </p>
            )}
            {capture.contextSuffix && (
              <p className={styles.context}>
                <span>After</span>
                {capture.contextSuffix}
              </p>
            )}
          </details>
        )}
      </section>
    </>
  );
}

function TagsTab({ tags, openGroups, onToggleGroup, onToggleTag, onClearTags }) {
  return (
    <>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Selected · {tags.length}</h3>
        <button type="button" className={styles.linkButton} onClick={onClearTags} disabled={tags.length === 0}>
          Clear all
        </button>
      </div>

      {tags.length > 0 ? (
        <ul className={styles.chipList} aria-label="Selected tags">
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className={styles.tagChip}
                onClick={() => onToggleTag(tag)}
                aria-label={`Remove ${getScriptTagLabel(tag)}`}
              >
                {getScriptTagLabel(tag)}
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>Open a category below to tag this scene.</p>
      )}

      <ul className={styles.categoryList}>
        {SCRIPT_TAG_CATEGORIES.map((group) => {
          const isOpen = openGroups.has(group.key);
          const selectedCount = group.tags.filter((tag) => tags.includes(tag.value)).length;
          const panelId = `annotator-tags-${group.key}`;

          return (
            <li key={group.key} className={styles.category}>
              <button
                type="button"
                className={`${styles.categoryToggle} ${isOpen ? styles.categoryToggleOpen : ""}`}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => onToggleGroup(group.key)}
              >
                <span className={styles.categoryLabel}>{group.label}</span>
                {selectedCount > 0 && <span className={styles.categoryBadge}>{selectedCount}</span>}
                <svg className={styles.chevron} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2.5 4.5L6 8l3.5-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {isOpen && (
                <ul id={panelId} className={styles.optionList}>
                  {group.tags.map((tag) => (
                    <li key={tag.value}>
                      <label className={styles.option}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={tags.includes(tag.value)}
                          onChange={() => onToggleTag(tag.value)}
                        />
                        <span>{tag.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * The annotator beside the PDF: a Capture tab (anchors, timing, captured
 * text) and a Tags tab that unlocks once there is text to tag, with Save
 * pinned to the bottom.
 */
export function AnnotatorPanel(props) {
  const {
    editing,
    sceneLabel,
    onNewScene,
    activeTab,
    onTabChange,
    tagsDisabled,
    tags,
    onToggleTag,
    onClearTags,
    saving,
    deleting,
    onSave,
    onDelete,
  } = props;
  const [openTagGroups, setOpenTagGroups] = useState(() => new Set());

  function toggleTagGroup(key) {
    setOpenTagGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <aside className={styles.panel} aria-label="Scene annotator">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={`${styles.eyebrow} ${editing ? styles.eyebrowEditing : ""}`}>
            {editing ? "Editing saved scene" : "New scene"}
          </p>
          <h2 className={styles.title}>{sceneLabel}</h2>
        </div>
        <button type="button" className={styles.newButton} onClick={onNewScene}>
          + New scene
        </button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Annotator sections">
        <button
          type="button"
          role="tab"
          id="annotator-tab-capture"
          aria-selected={activeTab === "capture"}
          aria-controls="annotator-tabpanel"
          className={`${styles.tab} ${activeTab === "capture" ? styles.tabActive : ""}`}
          onClick={() => onTabChange("capture")}
        >
          Capture
        </button>
        <button
          type="button"
          role="tab"
          id="annotator-tab-tags"
          aria-selected={activeTab === "tags"}
          aria-controls="annotator-tabpanel"
          className={`${styles.tab} ${activeTab === "tags" ? styles.tabActive : ""}`}
          disabled={tagsDisabled}
          title={tagsDisabled ? "Capture script text before tagging" : undefined}
          onClick={() => onTabChange("tags")}
        >
          Tags
          {tags.length > 0 && <span className={styles.tabBadge}>{tags.length}</span>}
        </button>
      </div>

      <div
        id="annotator-tabpanel"
        role="tabpanel"
        aria-labelledby={`annotator-tab-${activeTab}`}
        className={styles.body}
      >
        {activeTab === "tags" ? (
          <TagsTab
            tags={tags}
            openGroups={openTagGroups}
            onToggleGroup={toggleTagGroup}
            onToggleTag={onToggleTag}
            onClearTags={onClearTags}
          />
        ) : (
          <CaptureTab {...props} />
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.primaryButton} onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : editing ? "Update scene" : "Save scene"}
        </button>
        {editing && (
          <button type="button" className={styles.dangerButton} onClick={onDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </footer>
    </aside>
  );
}
