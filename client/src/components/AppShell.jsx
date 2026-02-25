import { Link } from "react-router-dom";
import styles from "./AppShell.module.css";

export default function AppShell({ children }) {
  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.dot} />
          <div>
            <div className={styles.title}>ShotDeck Annotator</div>
            <div className={styles.subtitle}>Local dev build</div>
          </div>
        </div>

        <nav className={styles.nav}>
          <Link to="/movies">Archive</Link>
          <Link to="/movies/new">Create Movie</Link>
        </nav>
      </header>

      <main className={styles.content}>{children}</main>
    </div>
  );
}