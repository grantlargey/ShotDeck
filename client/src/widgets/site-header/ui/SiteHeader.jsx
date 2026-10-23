import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "@/entities/session/model/useSession.js";
import { ChangePasswordDialog } from "@/features/auth/ui/ChangePasswordDialog.jsx";
import { SceneTextStyleToggle } from "@/features/scene-text-style/ui/SceneTextStyleToggle.jsx";
import { cx } from "@/shared/lib/cx.js";
import { BrandLogo } from "@/shared/ui/BrandLogo.jsx";
import { DropdownMenu } from "@/shared/ui/DropdownMenu.jsx";
import { ChevronDownIcon, PlusIcon } from "@/shared/ui/icons.jsx";
import { useHeaderScroll } from "../model/useHeaderScroll.js";
import styles from "./SiteHeader.module.css";

/**
 * The site's header. `pinned` keeps it at the top of the window as the page
 * scrolls (on phones it slides away while scrolling down); the script viewer
 * passes false, so the header scrolls off above the viewer's own pinned bar.
 * `floating` lays it over the top of a page whose hero runs up behind it.
 */
export default function SiteHeader({ pinned = true, floating = false }) {
  const { pathname } = useLocation();
  const headerRef = useRef(null);
  const { scrolled, hidden } = useHeaderScroll(headerRef, { enabled: pinned });
  const nav = useNavigate();
  const { isAdmin, isOwner, user, signOut } = useSession();
  const [changingPassword, setChangingPassword] = useState(false);
  const isNew = pathname === "/films/new";

  const navLinks = [
    { to: "/", label: "Explore", isActive: pathname === "/" },
    {
      to: "/library",
      label: "Library",
      isActive: pathname === "/library" || (pathname.startsWith("/films/") && pathname !== "/films/new"),
    },
    { to: "/script-search", label: "Script Search", isActive: pathname === "/script-search" },
  ];
  // A link lit by moving to its page types itself in; the one lit when the header mounts just shows.
  const litTo = navLinks.find((link) => link.isActive)?.to ?? null;
  const [lit, setLit] = useState({ to: litTo, typed: false });
  if (lit.to !== litTo) setLit({ to: litTo, typed: litTo !== null });

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
        // Over a hero, the header is clear until the page scrolls.
        pinned && floating && styles.navbarFloating,
        pinned && floating && !scrolled && styles.navbarClear,
        hidden && styles.navbarHidden
      )}
    >
      <div className={styles.navbarInner}>
        {/* The logo's page turns the scene text style; the wordmark is the way home. */}
        <div className={styles.brand}>
          <SceneTextStyleToggle />
          <Link className={styles.home} to="/">
            <BrandLogo showMark={false} />
          </Link>
        </div>

        <nav className={styles.primaryNav} aria-label="Primary">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              className={cx(
                styles.navLink,
                link.isActive && styles.navLinkActive,
                link.isActive && lit.typed && styles.navLinkTyped
              )}
              to={link.to}
              aria-current={link.isActive ? "page" : undefined}
            >
              {/* Holds the label's full width while it types, so the links beside it stay put. */}
              <span className={styles.label} style={{ "--letters": link.label.length }}>
                <span className={styles.typed}>{link.label}</span>
                <span className={styles.caret} aria-hidden="true" />
              </span>
            </Link>
          ))}
        </nav>

        {isAdmin && (
          <div className={styles.actions}>
            <Link
              to="/films/new"
              className={cx(styles.addFilm, isNew && styles.addFilmCurrent)}
              aria-current={isNew ? "page" : undefined}
            >
              <PlusIcon size={14} strokeWidth={1.8} className={styles.addFilmIcon} />
              Add Film
            </Link>

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
                  <span className={styles.monogram} aria-hidden="true">
                    {user.email.charAt(0)}
                  </span>
                  <span className={styles.accountRole}>{roleLabel}</span>
                  <ChevronDownIcon size={12} className={styles.accountChevron} />
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
