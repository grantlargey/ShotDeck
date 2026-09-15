import { useState } from "react";
import { filmTimingErrorWhileTyping } from "@/entities/script-scene/model/filmTiming.js";
import {
  getScriptTagLabel,
  SCRIPT_TAG_CATEGORIES,
} from "@/entities/script-scene/model/scriptTagCategories.js";
import { SceneCard } from "@/entities/script-scene/ui/SceneCard.jsx";
import { TagCategoryList } from "@/entities/script-scene/ui/TagCategoryList.jsx";
import { cx } from "@/shared/lib/cx.js";
import { formatSecondsToHms } from "@/shared/lib/time.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { Chip } from "@/shared/ui/Chip.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { Field } from "@/shared/ui/Field.jsx";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { CloseIcon, PlusIcon } from "@/shared/ui/icons.jsx";
import { Input } from "@/shared/ui/Input.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { undoShortcutLabel } from "../lib/platform.js";
import styles from "./AnnotatorPanel.module.css";

const ORIGIN_BADGES = {
  capture: { label: "Captured from PDF", tone: "success" },
  edited: { label: "Edited", tone: "warning" },
  ai: { label: "AI formatted", tone: "ai" },
  saved: { label: "Saved", tone: "neutral" },
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
  const badgeClass = cx(styles.anchorBadge, kind === "start" ? styles.anchorBadgeStart : styles.anchorBadgeEnd);

  if (!anchor) {
    return (
      <div className={cx(styles.anchorRow, styles.anchorRowEmpty)}>
        <span className={badgeClass}>{label[0]}</span>
        <span className={styles.anchorText}>
          <span className={styles.anchorLocation}>{label} anchor</span>
          <span className={styles.anchorPlaceholder}>Not placed</span>
        </span>
      </div>
    );
  }

  return (
    <div className={cx(styles.anchorRow, anchor.suggested && styles.anchorRowSuggested)}>
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
        <IconButton
          size="sm"
          label={`Scroll to the ${kind} anchor`}
          title="Scroll to anchor"
          onClick={() => onJump(kind)}
        >
          <CrosshairIcon />
        </IconButton>
        {!anchor.suggested && (
          <IconButton
            size="sm"
            label={`Remove the ${kind} anchor`}
            title="Remove anchor"
            onClick={() => onRemove(kind)}
          >
            <CloseIcon size={14} />
          </IconButton>
        )}
      </span>
    </div>
  );
}

function TimeField({ label, value, onChange, onBlur }) {
  return (
    <Field label={label}>
      <Input
        value={value}
        placeholder="00:00:00"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </Field>
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
  runtimeSeconds,
  onTimeChange,
  onTimeBlur,
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
  const originBadge = ORIGIN_BADGES[textOrigin];
  const timingError = filmTimingErrorWhileTyping(startTime, endTime, runtimeSeconds);

  return (
    <>
      <section className={styles.section} aria-labelledby="annotator-anchors">
        <div className={styles.sectionHeader}>
          <h3 id="annotator-anchors" className={styles.sectionTitle}>
            Anchors
          </h3>
          <div className={styles.sectionTools}>
            <Button
              size="sm"
              onClick={onUndoAnchors}
              disabled={!canUndo}
              title={`Undo anchor change (${undoShortcutLabel()})`}
            >
              Undo
            </Button>
            <Button size="sm" onClick={onClearAnchors} disabled={!hasAnchors}>
              Clear
            </Button>
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
          <Callout tone="warning" className={styles.callout} action="Edit that scene" onAction={onEditOverlapScene}>
            This range overlaps the saved scene at {formatSecondsToHms(overlapScene.start_time_seconds)}.
          </Callout>
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
        {timingError && (
          <Callout tone="error" className={styles.callout}>
            {timingError}
          </Callout>
        )}
      </section>

      <section className={styles.section} aria-labelledby="annotator-text">
        <div className={styles.sectionHeader}>
          <h3 id="annotator-text" className={styles.sectionTitle}>
            Script text
          </h3>
          {hasText && originBadge && <Badge tone={originBadge.tone}>{originBadge.label}</Badge>}
        </div>

        {captureStale && (
          <Callout tone="info" className={styles.callout} action="Re-capture from anchors" onAction={onRecapture}>
            {legacyText
              ? "This scene was saved before screenplay formatting."
              : "The anchors moved after this text was captured."}
          </Callout>
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
          <EmptyState compact>
            {anchors.start && anchors.end
              ? "Capturing text between the anchors…"
              : "Place a start and an end anchor to capture this scene's text."}
          </EmptyState>
        )}

        {hasText && (
          <div className={styles.buttonRow}>
            <Button size="sm" block onClick={onExpandDraft}>
              Expand &amp; edit
            </Button>
            <Button size="sm" block variant="ai" onClick={onRequestAi} disabled={proposal?.status === "loading"}>
              {proposal?.status === "loading" ? "Formatting…" : "Format with AI"}
            </Button>
          </div>
        )}

        {proposal?.status === "ready" && (
          <Callout tone="ai" className={styles.callout} action="Review" onAction={onReviewProposal}>
            An AI formatting proposal is ready. Nothing changes until you accept it.
          </Callout>
        )}

        {proposal?.status === "error" && (
          <Callout tone="error" className={styles.callout} action="Dismiss" onAction={onDiscardProposal}>
            {proposal.error}
          </Callout>
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
        <Button variant="link" size="sm" onClick={onClearTags} disabled={tags.length === 0}>
          Clear all
        </Button>
      </div>

      {tags.length > 0 ? (
        <ul className={styles.chipList} aria-label="Selected tags">
          {tags.map((tag) => (
            <li key={tag}>
              <Chip onRemove={() => onToggleTag(tag)} removeLabel={`Remove ${getScriptTagLabel(tag)}`}>
                {getScriptTagLabel(tag)}
              </Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>Open a category below to tag this scene.</p>
      )}

      <TagCategoryList
        className={styles.categoryList}
        groups={SCRIPT_TAG_CATEGORIES}
        selectedTags={tags}
        onToggleTag={onToggleTag}
        idPrefix="annotator-tags"
        openGroups={openGroups}
        onToggleGroup={onToggleGroup}
      />
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
  // Lives here so expanded categories survive switching tabs.
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
          <p className={cx(styles.eyebrow, editing && styles.eyebrowEditing)}>
            {editing ? "Editing saved scene" : "New scene"}
          </p>
          <h2 className={styles.title}>{sceneLabel}</h2>
        </div>
        <Button size="sm" onClick={onNewScene}>
          <PlusIcon size={14} />
          New scene
        </Button>
      </header>

      <SegmentedControl
        role="tablist"
        label="Annotator sections"
        idPrefix="annotator-tab"
        panelId="annotator-tabpanel"
        className={styles.tabs}
        value={activeTab}
        onChange={onTabChange}
        options={[
          { value: "capture", label: "Capture" },
          {
            value: "tags",
            label: "Tags",
            badge: tags.length,
            disabled: tagsDisabled,
            title: tagsDisabled ? "Capture script text before tagging" : undefined,
          },
        ]}
      />

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
        <Button variant="primary" className={styles.saveButton} onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : editing ? "Update scene" : "Save scene"}
        </Button>
        {editing && (
          <Button variant="danger" onClick={onDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        )}
      </footer>
    </aside>
  );
}
