import { Link } from "react-router-dom";
import { useSession } from "@/entities/session/model/useSession.js";
import { SceneTextStyleToggle } from "@/features/scene-text-style/ui/SceneTextStyleToggle.jsx";
import { BrandLogo } from "@/shared/ui/BrandLogo.jsx";
import styles from "./SiteFooter.module.css";

export default function SiteFooter() {
  const { isAdmin } = useSession();
  const links = [
    { to: "/", label: "Explore" },
    { to: "/library", label: "Library" },
    { to: "/script-search", label: "Script Search" },
    // Visitors get a discreet way in; admins already have the header controls.
    isAdmin ? { to: "/films/new", label: "Add Film" } : { to: "/login", label: "Admin" },
  ];

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <SceneTextStyleToggle size="sm" />
          <Link className={styles.home} to="/">
            <BrandLogo size="sm" showMark={false} />
          </Link>
        </div>

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
