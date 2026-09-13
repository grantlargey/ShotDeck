import { Link } from "react-router-dom";
import { BrandLogo } from "@/shared/ui";
import styles from "./SiteFooter.module.css";

const FOOTER_LINKS = [
  { to: "/movies", label: "My Projects" },
  { to: "/script-search", label: "Script Search" },
  { to: "/movies/new", label: "New Project" },
];

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <Link className={styles.brand} to="/">
          <BrandLogo size="sm" />
        </Link>

        <nav className={styles.nav} aria-label="Footer">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.to} className={styles.link} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
