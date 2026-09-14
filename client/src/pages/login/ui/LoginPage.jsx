import { useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "@/entities/session/model/useSession.js";
import { changePassword } from "@/shared/api/auth.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { Field } from "@/shared/ui/Field.jsx";
import { Input } from "@/shared/ui/Input.jsx";
import styles from "./LoginPage.module.css";

const MIN_PASSWORD_LENGTH = 12;

/** Only a path on this site is followed after sign-in, so a link can't bounce an admin elsewhere. */
function safeNextPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }
  return value;
}

/**
 * Admin sign-in. There is no sign-up: accounts come from the site owner. An
 * account given a temporary password chooses its own here before continuing.
 */
export default function LoginPage() {
  useDocumentTitle("Sign in");
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const { ready, isAdmin, signIn, applyUser } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // The temporary password just used, kept so the new one can replace it.
  const [temporaryPassword, setTemporaryPassword] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Signing in here must not trigger the "already signed in" redirect below.
  const signedInHereRef = useRef(false);

  if (ready && isAdmin && !signedInHereRef.current) return <Navigate to={next} replace />;

  async function submitSignIn(event) {
    event.preventDefault();
    setErr("");
    setBusy(true);
    signedInHereRef.current = true;
    try {
      const user = await signIn(email, password);
      if (user.must_change_password) setTemporaryPassword(password);
      else nav(next, { replace: true });
    } catch (e) {
      signedInHereRef.current = false;
      setErr(getErrorMessage(e, "Sign-in failed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword(event) {
    event.preventDefault();
    setErr("");
    try {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new ValidationError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
      if (newPassword !== confirmPassword) throw new ValidationError("The passwords don't match.");
      setBusy(true);
      const { user } = await changePassword({ currentPassword: temporaryPassword, newPassword });
      applyUser(user);
      nav(next, { replace: true });
    } catch (e) {
      setErr(getErrorMessage(e, "Couldn't save the password. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (temporaryPassword !== null) {
    return (
      <div className={styles.page}>
        <section className={styles.card} aria-labelledby="login-title">
          <div className={styles.intro}>
            <h1 id="login-title" className={styles.title}>
              Choose a new password
            </h1>
            <p className={styles.subtitle}>You signed in with a temporary password. Choose your own to continue.</p>
          </div>

          {err && <Callout tone="error">{err}</Callout>}

          <form className={styles.form} onSubmit={submitNewPassword}>
            <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`} required>
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Confirm new password" required>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {busy ? "Saving…" : "Save password and continue"}
            </Button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.intro}>
          <h1 id="login-title" className={styles.title}>
            Admin sign in
          </h1>
          <p className={styles.subtitle}>Only accounts created by the site owner can sign in.</p>
        </div>

        {err && <Callout tone="error">{err}</Callout>}

        <form className={styles.form} onSubmit={submitSignIn}>
          <Field label="Email" required>
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Password" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </section>
    </div>
  );
}
