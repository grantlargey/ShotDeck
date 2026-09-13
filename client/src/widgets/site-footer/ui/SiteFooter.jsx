import { Link } from "react-router-dom";
import { useSession } from "@/entities/session";
import { BrandLogo } from "@/shared/ui";
import styles from "./SiteFooter.module.css";

export default function SiteFooter() {
  const { isAdmin } = useSession();
  const links = [
    { to: "/movies", label: isAdmin ? "My Projects" : "Projects" },
    { to: "/script-search", label: "Script Search" },
    // Visitors get a discreet way in; admins already have the header controls.
    isAdmin ? { to: "/movies/new", label: "New Project" } : { to: "/login", label: "Admin" },
  ];

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <Link className={styles.brand} to="/">
          <BrandLogo size="sm" />
        </Link>

        <nav className={styles.nav} aria-label="Footer">
          {links.map((link) => (
            <Link key={link.to} className={styles.link} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
