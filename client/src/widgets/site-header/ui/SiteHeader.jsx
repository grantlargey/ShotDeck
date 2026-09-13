import { Link, useLocation } from "react-router-dom";
import { cx } from "@/shared/lib/cx";
import { BrandLogo, Button, PlusIcon } from "@/shared/ui";
import styles from "./SiteHeader.module.css";

const NAV_LINKS = [
  { to: "/", label: "Explore", isActive: (pathname) => pathname === "/" },
  {
    to: "/movies",
    label: "My Projects",
    isActive: (pathname) => pathname.startsWith("/movies") && pathname !== "/movies/new",
  },
  { to: "/script-search", label: "Script Search", isActive: (pathname) => pathname === "/script-search" },
];

export default function SiteHeader() {
  const { pathname } = useLocation();
  const isExplore = pathname === "/";
  const isNew = pathname === "/movies/new";

  return (
    <header className={cx(styles.navbar, isExplore && styles.navbarOverlay)}>
      <div className={styles.navbarInner}>
        <Link className={styles.brand} to="/">
          <BrandLogo />
        </Link>

        <nav className={styles.primaryNav} aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const active = link.isActive(pathname);
            return (
              <Link
                key={link.to}
                className={cx(styles.navLink, active && styles.navLinkActive)}
                to={link.to}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <Button
          as={Link}
          to="/movies/new"
          variant="primary"
          className={cx(styles.cta, isNew && styles.ctaActive)}
          aria-current={isNew ? "page" : undefined}
        >
          <PlusIcon size={14} />
          New Project
        </Button>
      </div>
    </header>
  );
}
