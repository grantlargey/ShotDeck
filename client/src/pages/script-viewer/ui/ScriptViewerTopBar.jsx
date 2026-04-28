import styles from "./ScriptViewerPage.module.css";

export function ScriptViewerTopBar({ title, onBackToMovie, onSearchScripts }) {
  return (
    <div className={styles.topBar}>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.topActions}>
        <button type="button" className={styles.ghostBtn} onClick={onBackToMovie}>
          Back To Movie
        </button>
        <button type="button" className={styles.ghostBtn} onClick={onSearchScripts}>
          Search All Scripts
        </button>
      </div>
    </div>
  );
}
