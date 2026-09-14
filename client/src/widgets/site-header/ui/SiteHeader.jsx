import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "@/entities/session";
import { ChangePasswordDialog } from "@/features/auth";
import { cx } from "@/shared/lib/cx.js";
import { BrandLogo, Button, ChevronDownIcon, DropdownMenu, PlusIcon } from "@/shared/ui";
import styles from "./SiteHeader.module.css";

export default function SiteHeader() {
  const { pathname } = useLocation();
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
    <header className={cx(styles.navbar, isExplore && styles.navbarOverlay)}>
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
