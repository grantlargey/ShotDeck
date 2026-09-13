import { useMemo, useState } from "react";
import { compareWordFidelity, screenplayToPlainText } from "@/shared/lib/screenplay";
import { ScreenplayView } from "@/shared/ui";
import {
  SceneDetailModal,
  SceneModalActions,
  SceneModalButton,
  SceneModalPaper,
} from "@/widgets/scene-detail-modal";
import { elementShortcutLabel } from "../lib/platform.js";
import { ScreenplayEditor } from "./ScreenplayEditor.jsx";
import styles from "./DraftEditorModal.module.css";

const MODES = [
  { value: "script", label: "Script" },
  { value: "markdown", label: "Markdown" },
];

function formatWordList(entries) {
  return entries
    .slice(0, 40)
    .map(({ word, count }) => (count > 1 ? `${word} ×${count}` : word))
    .join(", ");
}

function FidelitySummary({ subject, fidelity }) {
  if (fidelity.exact) {
    return (
      <p className={styles.fidelityOk}>
        {subject}: all {fidelity.baselineCount.toLocaleString()} captured words preserved
      </p>
    );
  }

  return (
    <details className={styles.fidelityWarn}>
      <summary>
        {subject}: {fidelity.missingCount} missing · {fidelity.addedCount} added words
      </summary>
      {fidelity.missing.length > 0 && (
        <p>
          <strong>Missing:</strong> {formatWordList(fidelity.missing)}
        </p>
      )}
      {fidelity.added.length > 0 && (
        <p>
          <strong>Added:</strong> {formatWordList(fidelity.added)}
        </p>
      )}
    </details>
  );
}

/**
 * Expanded draft editor. Edits apply to the draft immediately; an AI proposal
 * is shown side by side with the draft and only replaces it when accepted.
 * Both are checked word-for-word against the text captured from the PDF.
 */
export function DraftEditorModal({
  title,
  meta,
  editorKey,
  markdown,
  onChangeMarkdown,
  baselineText,
  proposal,
  onRequestAi,
  onAcceptProposal,
  onDiscardProposal,
  recaptureLabel,
  onRecapture,
  onClose,
}) {
  const [mode, setMode] = useState("script");
  const proposalReady = proposal?.status === "ready";
  const proposalMarkdown = proposalReady ? proposal.markdown : "";
  const showProposal = Boolean(proposal) && proposal.status !== "error";

  const draftFidelity = useMemo(
    () => (baselineText ? compareWordFidelity(baselineText, screenplayToPlainText(markdown)) : null),
    [baselineText, markdown]
  );
  const proposalFidelity = useMemo(
    () =>
      baselineText && proposalMarkdown
        ? compareWordFidelity(baselineText, screenplayToPlainText(proposalMarkdown))
        : null,
    [baselineText, proposalMarkdown]
  );

  return (
    <SceneDetailModal
      title={title}
      meta={meta}
      onClose={onClose}
      footer={
        <>
          <div className={styles.footerStart}>
            <div className={styles.segmented} role="radiogroup" aria-label="Editor mode">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  className={`${styles.segment} ${mode === option.value ? styles.segmentActive : ""}`}
                  onClick={() => setMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className={styles.fidelityGroup} aria-live="polite">
              {draftFidelity ? (
                <FidelitySummary subject="Draft" fidelity={draftFidelity} />
              ) : (
                <p className={styles.fidelityMuted}>The word check runs once text is captured from anchors.</p>
              )}
              {proposalFidelity && <FidelitySummary subject="AI proposal" fidelity={proposalFidelity} />}
              {proposal?.status === "error" && (
                <p className={styles.proposalError} role="alert">
                  {proposal.error}
                </p>
              )}
            </div>
          </div>

          <SceneModalActions>
            {proposalReady ? (
              <>
                <SceneModalButton onClick={onDiscardProposal}>Discard proposal</SceneModalButton>
                <SceneModalButton variant="primary" onClick={onAcceptProposal}>
                  Accept proposal
                </SceneModalButton>
              </>
            ) : (
              <>
                {proposal?.status === "error" && (
                  <SceneModalButton onClick={onDiscardProposal}>Dismiss error</SceneModalButton>
                )}
                {recaptureLabel && <SceneModalButton onClick={onRecapture}>{recaptureLabel}</SceneModalButton>}
                <SceneModalButton onClick={onRequestAi} disabled={proposal?.status === "loading"}>
                  {proposal?.status === "loading" ? "Formatting…" : "Format with AI"}
                </SceneModalButton>
                <SceneModalButton variant="primary" onClick={onClose}>
                  Done
                </SceneModalButton>
              </>
            )}
          </SceneModalActions>
        </>
      }
    >
      <SceneModalPaper
        label="Scene draft"
        heading={showProposal ? "Your draft" : undefined}
        toolbar={
          <p className={styles.editorHint}>
            {mode === "script"
              ? `Tab cycles the element type · ${elementShortcutLabel("1–8")} sets it · Shift+Enter adds a line break`
              : "## heading · ### character · > dialogue · > > (parenthetical) · <p align=\"right\"> transition"}
          </p>
        }
      >
        {mode === "script" ? (
          <ScreenplayEditor key={editorKey} initialMarkdown={markdown} onChange={onChangeMarkdown} />
        ) : (
          <textarea
            className={styles.source}
            value={markdown}
            spellCheck={false}
            aria-label="Screenplay markdown source"
            onChange={(event) => onChangeMarkdown(event.target.value)}
          />
        )}
      </SceneModalPaper>

      {showProposal && (
        <SceneModalPaper label="AI proposal" heading="AI proposal">
          {proposalReady ? (
            <ScreenplayView source={proposalMarkdown} />
          ) : (
            <p className={styles.loading}>Formatting with AI… long scenes can take up to a minute.</p>
          )}
        </SceneModalPaper>
      )}
    </SceneDetailModal>
  );
}
