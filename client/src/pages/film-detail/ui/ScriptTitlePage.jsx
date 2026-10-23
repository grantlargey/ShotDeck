import { useRef, useState } from "react";
import { splitCreditNames } from "@/entities/film/model/filmCredits.js";
import { cx } from "@/shared/lib/cx.js";
import { Button } from "@/shared/ui/Button.jsx";
import styles from "./FilmDetailPage.module.css";

/**
 * The script's title page, under the film's bound cover: the title and its
 * writers set the way a screenplay's first page sets them, on the paper of
 * the visitor's page style. It shows as the cover lifts or opens. It repeats
 * the hero's own details, so screen readers skip it.
 */
export function ScriptTitlePage({ film }) {
  const writers = splitCreditNames(film.writer).join(" & ");

  return (
    <div className={styles.titlePage} aria-hidden="true">
      {/* Capitals, as a title page has them; the page style may draw them as small capitals. */}
      <p className={styles.titlePageTitle}>{film.title.toUpperCase()}</p>
      {writers && (
        <>
          <p className={styles.titlePageBy}>Written by</p>
          <p className={styles.titlePageNames}>{writers}</p>
        </>
      )}
    </div>
  );
}

/**
 * The script, on the title page the open cover shows an admin: whether the
 * film has one, the way into it, and a PDF to upload, picked or dropped on
 * the page. Replacing a script deletes the scenes captured from it and their
 * tags, so the page asks first. `file` is the PDF picked to upload, if any.
 */
export function ScriptControls({ current, file, saving, onOpen, onFileChange, onUpload }) {
  const inputRef = useRef(null);
  // Asking before a replacement; any change to the picked PDF stops asking.
  const [confirming, setConfirming] = useState(false);

  function pick(next) {
    setConfirming(false);
    onFileChange(next);
  }

  function upload() {
    if (current && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onUpload();
  }

  function handleDragOver(event) {
    if (saving || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
  }

  function handleDrop(event) {
    const dropped = event.dataTransfer?.files?.[0];
    if (saving || !dropped) return;
    event.preventDefault();
    if (dropped.type === "application/pdf") pick(dropped);
  }

  let status = current ? "Script uploaded" : "No script yet";
  if (saving && file) status = "Uploading";

  return (
    <div
      className={styles.scriptControls}
      role="group"
      aria-label="Script"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <p className={styles.scriptStatus}>
        <span className={cx(styles.scriptDot, !current && styles.scriptDotEmpty, saving && file && styles.scriptDotBusy)} />
        {status}
      </p>

      {file ? (
        <>
          <p className={styles.scriptFile} title={file.name}>
            {file.name}
          </p>
          {confirming && (
            <p className={styles.scriptWarning} role="alert">
              Replace this script? Every scene captured from it, and the tags on those scenes, will be deleted. This
              can&apos;t be undone.
            </p>
          )}
          <div className={styles.scriptRow}>
            <Button
              size="sm"
              className={cx(styles.pageButton, styles.pagePlain)}
              disabled={saving}
              onClick={() => (confirming ? setConfirming(false) : pick(null))}
            >
              {confirming ? "Keep" : "Cancel"}
            </Button>
            <Button
              size="sm"
              variant={confirming ? "secondary" : "primary"}
              className={cx(styles.pageButton, confirming && styles.pageDanger)}
              disabled={saving}
              onClick={upload}
            >
              {saving ? "Uploading…" : confirming ? "Replace" : "Upload PDF"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {current ? (
            <Button size="sm" variant="primary" className={styles.pageButton} onClick={onOpen}>
              Open script
            </Button>
          ) : (
            <p className={styles.scriptDrop}>Drop the script PDF here</p>
          )}
          <Button
            size="sm"
            variant={current ? "secondary" : "primary"}
            className={cx(styles.pageButton, current && styles.pagePlain)}
            disabled={saving}
            onClick={() => inputRef.current?.click()}
          >
            {current ? "Replace PDF" : "Choose PDF"}
          </Button>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className={styles.fileNative}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          pick(event.target.files?.[0] ?? null);
          // Clear the native value so picking the same file again still fires.
          event.target.value = "";
        }}
      />
    </div>
  );
}
