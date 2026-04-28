import { SCRIPT_TAG_CATEGORIES } from "@/entities/script-scene";
import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time";
import styles from "./ScriptViewerPage.module.css";

export function SceneAnnotationForm({
  deletingSceneId,
  editingSceneId,
  form,
  formatAccepted,
  formatMessage,
  formatStatus,
  onDeleteScene,
  onNewScene,
  onSelectFormattedText,
  onSubmitScene,
  onToggleTag,
  saving,
  selectedCountText,
  selectedTextPreview,
  setForm,
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <h2 className={styles.cardTitle}>
          {editingSceneId ? "Edit Scene Annotation" : "New Scene Annotation"}
        </h2>
        <button type="button" className={styles.smallBtn} onClick={onNewScene}>
          New
        </button>
      </div>
      <p className={styles.subtle}>
        Select text in the PDF to anchor a scene. Selecting an already-anchored range opens the
        existing scene.
      </p>

      <form onSubmit={onSubmitScene} className={styles.form}>
        <div className={styles.row}>
          <label className={styles.label}>
            Start Time (HH:MM:SS)
            <input
              type="text"
              value={form.start_time_seconds}
              onChange={(e) => setForm((prev) => ({ ...prev, start_time_seconds: e.target.value }))}
              onBlur={(e) => {
                const parsed = parseTimeInputToSeconds(e.target.value);
                if (parsed !== null) {
                  setForm((prev) => ({
                    ...prev,
                    start_time_seconds: formatSecondsToHms(parsed, { fallback: "00:00:00" }),
                  }));
                }
              }}
              placeholder="00:00:00"
              className={styles.input}
              required
            />
          </label>

          <label className={styles.label}>
            End Time (HH:MM:SS)
            <input
              type="text"
              value={form.end_time_seconds}
              onChange={(e) => setForm((prev) => ({ ...prev, end_time_seconds: e.target.value }))}
              onBlur={(e) => {
                const parsed = parseTimeInputToSeconds(e.target.value);
                if (parsed !== null) {
                  setForm((prev) => ({
                    ...prev,
                    end_time_seconds: formatSecondsToHms(parsed, { fallback: "00:00:00" }),
                  }));
                }
              }}
              placeholder="00:00:00"
              className={styles.input}
              required
            />
          </label>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            Page Start
            <input
              type="number"
              min="1"
              value={form.page_start}
              onChange={(e) => setForm((prev) => ({ ...prev, page_start: e.target.value }))}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            Page End
            <input
              type="number"
              min="1"
              value={form.page_end}
              onChange={(e) => setForm((prev) => ({ ...prev, page_end: e.target.value }))}
              className={styles.input}
            />
          </label>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            Start Offset
            <input
              type="number"
              min="0"
              value={form.start_offset}
              onChange={(e) => setForm((prev) => ({ ...prev, start_offset: e.target.value }))}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            End Offset
            <input
              type="number"
              min="0"
              value={form.end_offset}
              onChange={(e) => setForm((prev) => ({ ...prev, end_offset: e.target.value }))}
              className={styles.input}
            />
          </label>
        </div>

        <div className={styles.label}>
          <span>Selected Text</span>
          {formatStatus === "loading" && <p className={styles.formatState}>Formatting selection...</p>}
          {formatMessage && <p className={styles.formatState}>{formatMessage}</p>}

          <div className={styles.choiceRow}>
            <label className={styles.choiceLabel}>
              <input
                type="radio"
                name="text_source"
                value="formatted"
                checked={form.text_source === "formatted"}
                onChange={onSelectFormattedText}
              />
              Use formatted text{formatAccepted ? " (Recommended)" : ""}
            </label>
            <label className={styles.choiceLabel}>
              <input
                type="radio"
                name="text_source"
                value="raw"
                checked={form.text_source === "raw"}
                onChange={() => setForm((prev) => ({ ...prev, text_source: "raw" }))}
              />
              Use raw text
            </label>
          </div>

          <textarea value={selectedTextPreview} rows={7} className={styles.textarea} readOnly />
        </div>
        <p className={styles.selectionPreview}>{selectedCountText}</p>

        {SCRIPT_TAG_CATEGORIES.map((group) => (
          <fieldset key={group.key} className={styles.tagGroup}>
            <legend>{group.label}</legend>
            <div className={styles.tagsGrid}>
              {group.tags.map((tag) => (
                <label key={tag.value} className={styles.tagChip}>
                  <input
                    type="checkbox"
                    checked={form.tags.includes(tag.value)}
                    onChange={() => onToggleTag(tag.value)}
                  />
                  {tag.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className={styles.actionRow}>
          <button className={styles.saveBtn} type="submit" disabled={saving}>
            {saving ? "Saving..." : editingSceneId ? "Update Scene" : "Save Scene"}
          </button>
          {editingSceneId && (
            <button
              type="button"
              className={styles.deleteBtn}
              disabled={deletingSceneId === editingSceneId}
              onClick={() => onDeleteScene(editingSceneId)}
            >
              {deletingSceneId === editingSceneId ? "Deleting..." : "Delete Scene"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
