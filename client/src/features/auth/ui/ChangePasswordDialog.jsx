import { useState } from "react";
import { useSession } from "@/entities/session";
import { changePassword } from "@/shared/api/auth.js";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors.js";
import { Button, Callout, Dialog, Field, Input } from "@/shared/ui";
import styles from "./ChangePasswordDialog.module.css";

const MIN_PASSWORD_LENGTH = 12;

/** Lets a signed-in admin replace their own password. Other browsers are signed out afterwards. */
export function ChangePasswordDialog({ onClose }) {
  const { user, applyUser } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const title = user?.must_change_password ? "Set your password" : "Change password";

  async function submit(event) {
    event.preventDefault();
    setErr("");
    try {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new ValidationError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
      if (newPassword !== confirmPassword) throw new ValidationError("The passwords don't match.");
      setBusy(true);
      const { user: updated } = await changePassword({ currentPassword, newPassword });
      applyUser(updated);
      setSaved(true);
    } catch (e) {
      setErr(getErrorMessage(e, "Couldn't change the password. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <Dialog
        title={title}
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <Callout tone="success">Your password was changed. Other browsers you were signed in on have been signed out.</Callout>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="change-password-form" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </Button>
        </>
      }
    >
      <form id="change-password-form" className={styles.form} onSubmit={submit}>
        {user?.must_change_password && (
          <Callout tone="info">You're using a temporary password. Choose your own to keep access.</Callout>
        )}
        {err && <Callout tone="error">{err}</Callout>}
        <Field label="Current password" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`} required>
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
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
      </form>
    </Dialog>
  );
}
