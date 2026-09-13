import styles from "./ScriptViewerPage.module.css";

export function ViewerTopBar({ title, pageCount, sceneCount, onBackToMovie, onSearchScripts, onJumpToScenes }) {
  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.backButton} onClick={onBackToMovie}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M8.5 2.5L4 7l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Movie
      </button>

      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        {pageCount > 0 && <span className={styles.titleMeta}>Script · {pageCount} pages</span>}
      </div>

      <div className={styles.topActions}>
        <button type="button" className={styles.topButton} onClick={onJumpToScenes}>
          Scenes
          <span className={styles.countPill}>{sceneCount}</span>
        </button>
        <button type="button" className={styles.topButton} onClick={onSearchScripts}>
          Search all scripts
        </button>
      </div>
    </div>
  );
}
