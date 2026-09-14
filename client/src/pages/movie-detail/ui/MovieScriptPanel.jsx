import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { FileInput } from "@/shared/ui/FileInput.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import styles from "./MovieDetailPage.module.css";

/**
 * Script status and, for admins, upload. Upload controls only appear once a
 * PDF has been chosen. Visitors see the status alone.
 */
export function MovieScriptPanel({
  currentScript,
  canEdit,
  scriptFile,
  savingScript,
  onScriptFileChange,
  onSaveScript,
}) {
  let status;
  if (canEdit) {
    status = currentScript
      ? "Open the script to capture and tag scenes, or upload a new PDF to replace it."
      : "Upload the script PDF to start capturing and tagging scenes.";
  } else {
    status = currentScript
      ? "Open the script to read it alongside its captured scenes."
      : "No script has been added to this project yet.";
  }

  return (
    <section aria-labelledby="project-script-heading">
      <SectionHeading
        id="project-script-heading"
        title="Script"
        badge={currentScript ? <Badge tone="success">Uploaded</Badge> : <Badge>Not uploaded</Badge>}
      />

      <div className={styles.scriptRow}>
        <p className={styles.scriptStatus}>{status}</p>

        {canEdit && (
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
        )}
      </div>
    </section>
  );
}
