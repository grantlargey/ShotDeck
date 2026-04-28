import { Link, useLocation } from "react-router-dom";
import styles from "./SiteHeader.module.css";

export default function SiteHeader() {
  const { pathname } = useLocation();

  const isExplore = pathname === "/";
  const isNew = pathname === "/movies/new";
  const isProjects = pathname.startsWith("/movies") && !isNew;
  const isScriptSearch = pathname === "/script-search";

  return (
    <header className={`${styles.navbar} ${isExplore ? styles.navbarOverlay : styles.navbarSolid}`}>
      <div className={styles.navbarInner}>
        <Link className={styles.brand} to="/">
          <span className={styles.logo} aria-hidden="true" />
          <span className={styles.brandText}>ScriptDeck</span>
        </Link>

        <nav className={styles.primaryNav} aria-label="Primary">
          <Link
            className={`${styles.navLink} ${isExplore ? styles.navLinkActive : ""}`}
            to="/"
          >
            Explore
          </Link>

          <Link
            className={`${styles.navLink} ${isProjects ? styles.navLinkActive : ""}`}
            to="/movies"
          >
            My Projects
          </Link>

          <Link
            className={`${styles.navLink} ${isScriptSearch ? styles.navLinkActive : ""}`}
            to="/script-search"
          >
            Script Search
          </Link>
        </nav>

        <Link
          className={styles.newProjectLink}
          to="/movies/new"
          aria-current={isNew ? "page" : undefined}
        >
          + New Project
        </Link>
      </div>
    </header>
  );
}
