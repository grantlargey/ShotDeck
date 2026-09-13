import { Badge, Button, FileInput, SectionHeading } from "@/shared/ui";
import styles from "./MovieDetailPage.module.css";

/** Script status and upload. Upload controls only appear once a PDF has been chosen. */
export function MovieScriptPanel({ currentScript, scriptFile, savingScript, onScriptFileChange, onSaveScript }) {
  return (
    <section aria-labelledby="project-script-heading">
      <SectionHeading
        id="project-script-heading"
        title="Script"
        badge={currentScript ? <Badge tone="success">Uploaded</Badge> : <Badge>Not uploaded</Badge>}
      />

      <div className={styles.scriptRow}>
        <p className={styles.scriptStatus}>
          {currentScript
            ? "Open the script to capture and tag scenes, or upload a new PDF to replace it."
            : "Upload the script PDF to start capturing and tagging scenes."}
        </p>

        <div className={styles.scriptActions}>
          {scriptFile ? (
            <>
              <span className={styles.fileName} title={scriptFile.name}>
                {scriptFile.name}
              </span>
              <Button size="sm" disabled={savingScript} onClick={() => onScriptFileChange(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={savingScript} onClick={onSaveScript}>
                {savingScript ? "Uploading…" : "Upload PDF"}
              </Button>
            </>
          ) : (
            <FileInput
              accept="application/pdf"
              file={null}
              onChange={onScriptFileChange}
              label={currentScript ? "Replace PDF" : "Choose PDF"}
              placeholder={null}
            />
          )}
        </div>
      </div>
    </section>
  );
}
