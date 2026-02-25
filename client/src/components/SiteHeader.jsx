import { Link, useLocation } from "react-router-dom";
import styles from "./SiteHeader.module.css";

export default function SiteHeader() {
  const { pathname } = useLocation();

  const isHome = pathname === "/";
  const isArchive = pathname === "/movies";
  const isNew = pathname === "/movies/new" || pathname.includes("/edit");

  return (
    <header className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.h1}>Movie Annotator</h1>
      </div>

      <nav className={styles.nav}>
        <Link className={isHome ? styles.active : ""} to="/">
          Home
        </Link>

        <Link className={isNew ? styles.active : ""} to="/movies/new">
          Create New Entry
        </Link>

        <Link className={isArchive ? styles.active : ""} to="/movies">
          Archive
        </Link>
      </nav>
    </header>
  );
}