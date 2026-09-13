import { Badge, Button, FileInput, Panel } from "@/shared/ui";
import styles from "./MovieDetailPage.module.css";

export function MovieScriptPanel({ currentScript, scriptFile, savingScript, onScriptFileChange, onSaveScript }) {
  return (
    <Panel
      title={
        <>
          Script
          {currentScript ? <Badge tone="success">Uploaded</Badge> : <Badge>Not uploaded</Badge>}
        </>
      }
    >
      <div className={styles.scriptRow}>
        <p className={styles.scriptStatus}>
          {currentScript
            ? "Open the script to capture and tag scenes, or upload a new PDF to replace it."
            : "Upload the script PDF to start capturing and tagging scenes."}
        </p>

        <div className={styles.scriptActions}>
          <FileInput
            accept="application/pdf"
            file={scriptFile}
            onChange={onScriptFileChange}
            label={currentScript ? "Replace PDF" : "Choose PDF"}
            placeholder={null}
          />
          <Button size="sm" variant="primary" disabled={!scriptFile || savingScript} onClick={onSaveScript}>
            {savingScript ? "Saving…" : "Save script"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
