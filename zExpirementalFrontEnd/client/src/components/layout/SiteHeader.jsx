// Renders the global navigation bar and keeps primary route 
// links visually in sync with the current URL.
import { Link, useLocation } from "react-router-dom";
import styles from "./SiteHeader.module.css";


// The SiteHeader component renders a header with a title and a nav bar.
// It uses the useLocation hook to detect the current path and highlight the active link.
export default function SiteHeader() {
  const { pathname } = useLocation();

  // These booleans keep the JSX readable and make the active-state styling explicit.
  const isExplore = pathname === "/" || pathname === "/explore";
  const isMyProjects = pathname === "/my-projects";
  const isCreateProject = pathname === "/create-project";

  return (
    <header className={styles.sdNavbar}>
      <div className={styles.sdNavbarInner}>
        <Link className={styles.sdNavbarBrand} to="/">
          <span className={styles.sdNavbarLogo} aria-hidden="true"></span>
          <span className={styles.sdNavbarBrandText}>ScriptDeck</span>
        </Link>

        <nav className={styles.sdNavbarCenter} aria-label="Primary">
          <Link
            className={`${styles.sdNavbarLink} ${isExplore ? styles.sdNavbarLinkActive : ""}`}
            to="/explore"
          >
            Explore
          </Link>

          <Link
            className={`${styles.sdNavbarLink} ${isMyProjects ? styles.sdNavbarLinkActive : ""}`}
            to="/my-projects"
          >
            My Projects
          </Link>
        </nav>

        <div className={styles.sdNavbarRight}>
          <Link
            className={styles.sdNavbarNewProject}
            to="/create-project"
            aria-current={isCreateProject ? "page" : undefined}
          >
            + New Project
          </Link>
        </div>
      </div>
    </header>
  );
}
