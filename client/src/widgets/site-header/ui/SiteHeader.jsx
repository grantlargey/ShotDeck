import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "@/entities/session/model/useSession.js";
import { ChangePasswordDialog } from "@/features/auth/ui/ChangePasswordDialog.jsx";
import { cx } from "@/shared/lib/cx.js";
import { BrandLogo } from "@/shared/ui/BrandLogo.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { DropdownMenu } from "@/shared/ui/DropdownMenu.jsx";
import { ChevronDownIcon, PlusIcon } from "@/shared/ui/icons.jsx";
import { useHeaderScroll } from "../model/useHeaderScroll.js";
import styles from "./SiteHeader.module.css";

/**
 * The site's header. `pinned` keeps it at the top of the window as the page
 * scrolls (on phones it slides away while scrolling down); the script viewer
 * passes false, so the header scrolls off above the viewer's own pinned bar.
 */
export default function SiteHeader({ pinned = true }) {
  const { pathname } = useLocation();
  const headerRef = useRef(null);
  const { scrolled, hidden } = useHeaderScroll(headerRef, { enabled: pinned });
  const nav = useNavigate();
  const { isAdmin, isOwner, user, signOut } = useSession();
  const [changingPassword, setChangingPassword] = useState(false);
  const isExplore = pathname === "/";
  const isNew = pathname === "/movies/new";

  const navLinks = [
    { to: "/", label: "Explore", isActive: pathname === "/" },
    {
      to: "/movies",
      // Visitors browse the projects; the library is "mine" only once signed in.
      label: isAdmin ? "My Projects" : "Projects",
      isActive: pathname.startsWith("/movies") && pathname !== "/movies/new",
    },
    { to: "/script-search", label: "Script Search", isActive: pathname === "/script-search" },
  ];

  const accountItems = [
    ...(isOwner ? [{ key: "admins", label: "Manage admins", onSelect: () => nav("/admin/users") }] : []),
    {
      key: "password",
      label: user?.must_change_password ? "Set your password" : "Change password",
      onSelect: () => setChangingPassword(true),
    },
    {
      key: "signout",
      label: "Sign out",
      tone: "danger",
      onSelect: async () => {
        await signOut();
        nav("/");
      },
    },
  ];
  const roleLabel = isOwner ? "Owner" : "Admin";

  return (
    <header
      ref={headerRef}
      className={cx(
        styles.navbar,
        !pinned && styles.navbarStatic,
        // Home: the header floats over the hero, clear until the page scrolls.
        pinned && isExplore && styles.navbarFloating,
        pinned && isExplore && !scrolled && styles.navbarClear,
        hidden && styles.navbarHidden
      )}
    >
      <div className={styles.navbarInner}>
        <Link className={styles.brand} to="/">
          <BrandLogo />
        </Link>

        <nav className={styles.primaryNav} aria-label="Primary">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              className={cx(styles.navLink, link.isActive && styles.navLinkActive)}
              to={link.to}
              aria-current={link.isActive ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {isAdmin && (
          <div className={styles.actions}>
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

            <DropdownMenu
              label="Account"
              header={
                <>
                  <strong>{user.email}</strong>
                  <span>{roleLabel}</span>
                </>
              }
              items={accountItems}
              trigger={(props) => (
                <button type="button" className={styles.account} title={user.email} {...props}>
                  <span className={styles.avatar} aria-hidden="true">
                    {user.email.charAt(0)}
                  </span>
                  <span className={styles.accountLabel}>{roleLabel}</span>
                  <ChevronDownIcon size={12} />
                </button>
              )}
            />
          </div>
        )}
      </div>

      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </header>
  );
}
