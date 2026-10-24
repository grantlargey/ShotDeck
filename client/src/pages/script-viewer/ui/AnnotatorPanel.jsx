import { useState } from "react";
import { filmTimingErrorWhileTyping, formatFilmTiming } from "@/entities/script-scene/model/filmTiming.js";
import {
  getScriptTagLabel,
  SCRIPT_TAG_CATEGORIES,
} from "@server/domain/script-tags.js";
import { SceneCard } from "@/entities/script-scene/ui/SceneCard.jsx";
import { TagCategoryList } from "@/entities/script-scene/ui/TagCategoryList.jsx";
import { cx } from "@/shared/lib/cx.js";
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
import { ANCHOR_KEYS, ANCHOR_NAMES } from "../model/anchorNames.js";
import { scriptLocationOverlapError } from "../model/sceneDraft.js";
import { AnchorGlyph } from "./AnchorGlyph.jsx";
import styles from "./AnnotatorPanel.module.css";

// Where the draft's text came from, said quietly beside its heading.
const ORIGIN_LABELS = {
  capture: "Captured from PDF",
  edited: "Edited",
  ai: "AI formatted",
  saved: "Saved",
};

/*
 * What the Script text section says when the draft has no text to show, keyed by
 * the draft's reason its Captured text is unavailable. Saving answers the same
 * question from the same reason, in the voice of a refusal
 * (CAPTURE_UNAVAILABLE_ERRORS), so the panel can no longer promise a capture
 * that will never arrive: a scan in the range reads as unreadable here too,
 * rather than waiting on indexing that has already finished. Either missing
 * anchor asks for the same thing, because capturing needs both. "ready" is the
 * remaining case: the anchors do capture text, and the admin emptied the
 * draft's own text by hand.
 */
const PLACE_ANCHORS_HINT = `Set ${ANCHOR_NAMES.start} and ${ANCHOR_NAMES.end} in the script to capture this scene's text.`;
const NO_TEXT_HINTS = {
  start: PLACE_ANCHORS_HINT,
  end: PLACE_ANCHORS_HINT,
  indexing: "Capturing text between the anchors…",
  unreadable: "The script text between the anchors can't be read. Move the anchors to lines with text.",
  ready: "This scene draft has no text.",
};

function CrosshairIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Begin or End: its bracket, where it is, and the words of the line it's on.
 * Before its page is indexed, only the page is known.
 */
function AnchorRow({ kind, anchor, line, onJump, onRemove }) {
  const name = ANCHOR_NAMES[kind];

  if (!anchor) {
    return (
      <div className={cx(styles.anchorRow, styles.anchorRowEmpty)}>
        <AnchorGlyph kind={kind} empty />
        <span className={styles.anchorText}>
          <span className={styles.anchorLocation}>{name}</span>
          <span className={styles.anchorPlaceholder}>Not placed</span>
        </span>
      </div>
    );
  }

  return (
    <div className={styles.anchorRow}>
      <AnchorGlyph kind={kind} />
      <span className={styles.anchorText}>
        <span className={styles.anchorLocation}>
          {line ? `${name} · Page ${anchor.page} · Line ${line.index + 1}` : name}
        </span>
        <span className={line ? styles.anchorLine : styles.anchorPlaceholder}>
          {line ? line.text : `Page ${anchor.page}`}
        </span>
      </span>
      <span className={styles.anchorActions}>
        <IconButton size="sm" label={`Scroll to ${name}`} title={`Scroll to ${name}`} onClick={() => onJump(kind)}>
          <CrosshairIcon />
        </IconButton>
        <IconButton size="sm" label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => onRemove(kind)}>
          <CloseIcon size={14} />
        </IconButton>
      </span>
    </div>
  );
}

function TimeField({ label, value, onChange, onBlur }) {
  return (
    <Field label={label}>
      <Input
        numeric
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
  draft,
  draftActions,
  indexStatus,
  overlapScene,
  onEditOverlapScene,
  anchorLines,
  onJumpToAnchor,
  runtimeSeconds,
  filmTitle,
  onRecapture,
  onExpandDraft,
  onJumpToScene,
  onRequestAi,
  onReviewProposal,
}) {
  const { anchors, canUndoAnchors, captureUnavailable, startTime, endTime, text, textOrigin, textStale } = draft;
  const hasAnchors = Boolean(anchors.start || anchors.end);
  const hasText = Boolean(text.trim());
  const originLabel = ORIGIN_LABELS[textOrigin];
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
              onClick={draftActions.undoAnchors}
              disabled={!canUndoAnchors}
              title={`Undo anchor change (${undoShortcutLabel()})`}
            >
              Undo
            </Button>
            <Button size="sm" onClick={draftActions.clearAnchors} disabled={!hasAnchors}>
              Clear
            </Button>
          </div>
        </div>

        <div className={styles.anchorList}>
          {["start", "end"].map((kind) => (
            <AnchorRow
              key={kind}
              kind={kind}
              anchor={anchors[kind]}
              line={anchorLines?.[kind] ?? null}
              onJump={onJumpToAnchor}
              onRemove={draftActions.removeAnchor}
            />
          ))}
        </div>

        {!(anchors.start && anchors.end) && (
          <p className={styles.hint}>
            Right-click a line in the script to set {ANCHOR_NAMES.start} or {ANCHOR_NAMES.end}. Or hover a line and
            press <kbd>{ANCHOR_KEYS.start}</kbd> for {ANCHOR_NAMES.start} or <kbd>{ANCHOR_KEYS.end}</kbd> for{" "}
            {ANCHOR_NAMES.end}.
          </p>
        )}

        {!indexStatus.complete && indexStatus.total > 0 && (
          <p className={styles.hint}>
            Indexing script text… {indexStatus.loaded} of {indexStatus.total} pages
          </p>
        )}

        {overlapScene && (
          <Callout tone="error" className={styles.callout} action="Edit that scene" onAction={onEditOverlapScene}>
            {scriptLocationOverlapError(overlapScene)}
          </Callout>
        )}
      </section>

      <section className={styles.section} aria-labelledby="annotator-timing">
        <h3 id="annotator-timing" className={styles.sectionTitle}>
          Film timing
        </h3>
        <div className={styles.fieldRow}>
          <TimeField
            label={ANCHOR_NAMES.start}
            value={startTime}
            onChange={(value) => draftActions.setTime("startTime", value)}
            onBlur={() => draftActions.normalizeTime("startTime")}
          />
          <TimeField
            label={ANCHOR_NAMES.end}
            value={endTime}
            onChange={(value) => draftActions.setTime("endTime", value)}
            onBlur={() => draftActions.normalizeTime("endTime")}
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
          {hasText && originLabel && (
            <span className={cx(styles.origin, textOrigin === "ai" && styles.originAi)}>{originLabel}</span>
          )}
        </div>

        {textStale && (
          <Callout tone="neutral" className={styles.callout} action="Re-capture from anchors" onAction={onRecapture}>
            The anchors moved after this text was captured.
          </Callout>
        )}

        {hasText ? (
          <SceneCard
            scene={draft.previewScene}
            title={filmTitle}
            tooltip="Click to scroll to scene · Double-click to expand and edit"
            onClick={onJumpToScene}
            onDoubleClick={onExpandDraft}
            onKeyActivate={onExpandDraft}
          />
        ) : (
          <EmptyState
            compact
            action={
              captureUnavailable ? null : (
                <Button size="sm" onClick={onRecapture}>
                  Re-capture from anchors
                </Button>
              )
            }
          >
            {NO_TEXT_HINTS[captureUnavailable ?? "ready"]}
          </EmptyState>
        )}

        {hasText && (
          <div className={styles.buttonRow}>
            <Button size="sm" block onClick={onExpandDraft}>
              Expand &amp; edit
            </Button>
            <Button
              size="sm"
              block
              variant="ai"
              onClick={onRequestAi}
              disabled={draft.proposal?.status === "loading"}
            >
              {draft.proposal?.status === "loading" ? "Formatting…" : "Format with AI"}
            </Button>
          </div>
        )}

        {draft.proposal?.status === "ready" && (
          <Callout tone="ai" className={styles.callout} action="Review" onAction={onReviewProposal}>
            An AI formatting proposal is ready. Nothing changes until you accept it.
          </Callout>
        )}

        {draft.proposal?.status === "error" && (
          <Callout tone="error" className={styles.callout} action="Dismiss" onAction={draftActions.discardProposal}>
            {draft.proposal.error}
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
        <Button
          variant="link"
          size="sm"
          className={styles.clearTags}
          onClick={onClearTags}
          disabled={tags.length === 0}
        >
          Clear all
        </Button>
      </div>

      {tags.length > 0 ? (
        <ul className={styles.chipList} aria-label="Selected tags">
          {tags.map((tag) => (
            <li key={tag}>
              <Chip
                onRemove={() => onToggleTag(tag)}
                removeLabel={`Remove ${getScriptTagLabel(tag)}`}
              >
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
        look="quiet"
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
 *
 * It reads the scene draft and calls `draftActions` itself. The page passes
 * what it owns: the tab, the film's title and runtime, indexing progress, the
 * overlapping scene, the lines Begin and End sit on, request state, and the
 * handlers that prompt or send a request.
 */
export function AnnotatorPanel({
  draft,
  draftActions,
  activeTab,
  onTabChange,
  filmTitle,
  runtimeSeconds,
  indexStatus,
  overlapScene,
  onEditOverlapScene,
  onNewScene,
  anchorLines,
  onJumpToAnchor,
  onJumpToScene,
  onRecapture,
  onExpandDraft,
  onRequestAi,
  onReviewProposal,
  saving,
  deleting,
  onSave,
  onDelete,
}) {
  const editing = Boolean(draft.savedScene?.id);
  const sceneLabel = draft.savedScene ? formatFilmTiming(draft.savedScene) : "Untitled scene";
  // Tagging needs text to tag, so an empty draft stays on the Capture tab.
  const tagsDisabled = !draft.text.trim();
  const visibleTab = tagsDisabled ? "capture" : activeTab;
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
          <p className={styles.eyebrow}>{editing ? "Editing saved scene" : "New scene"}</p>
          <h2 className={cx(styles.title, draft.savedScene && styles.titleTiming)}>{sceneLabel}</h2>
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
        quietBadges
        value={visibleTab}
        onChange={onTabChange}
        options={[
          { value: "capture", label: "Capture" },
          {
            value: "tags",
            label: "Tags",
            badge: draft.tags.length,
            disabled: tagsDisabled,
            title: tagsDisabled ? "Capture script text before tagging" : undefined,
          },
        ]}
      />

      <div
        id="annotator-tabpanel"
        role="tabpanel"
        aria-labelledby={`annotator-tab-${visibleTab}`}
        className={styles.body}
      >
        {visibleTab === "tags" ? (
          <TagsTab
            tags={draft.tags}
            openGroups={openTagGroups}
            onToggleGroup={toggleTagGroup}
            onToggleTag={draftActions.toggleTag}
            onClearTags={draftActions.clearTags}
          />
        ) : (
          <CaptureTab
            draft={draft}
            draftActions={draftActions}
            indexStatus={indexStatus}
            overlapScene={overlapScene}
            onEditOverlapScene={onEditOverlapScene}
            anchorLines={anchorLines}
            onJumpToAnchor={onJumpToAnchor}
            onJumpToScene={onJumpToScene}
            runtimeSeconds={runtimeSeconds}
            filmTitle={filmTitle}
            onRecapture={onRecapture}
            onExpandDraft={onExpandDraft}
            onRequestAi={onRequestAi}
            onReviewProposal={onReviewProposal}
          />
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
