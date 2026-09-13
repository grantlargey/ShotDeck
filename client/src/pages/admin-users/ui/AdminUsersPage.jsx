import { useEffect, useState } from "react";
import { useSession } from "@/entities/session";
import { api } from "@/shared/api";
import { useDocumentTitle } from "@/shared/lib/document-title";
import { getErrorMessage } from "@/shared/lib/errors";
import { Badge, Button, Callout, Dialog, Field, Input, PageHeader, PlusIcon } from "@/shared/ui";
import styles from "./AdminUsersPage.module.css";

const MIN_PASSWORD_LENGTH = 12;

function formatWhen(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Add an admin, or reset one's password. A password left blank asks the API
 * for a temporary one that the person must replace at first sign-in; a
 * password typed here is theirs to keep.
 */
function PasswordDialog({ mode, admin, onClose, onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdd = mode === "add";

  async function submit(event) {
    event.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const result = isAdd
        ? await api.createAdmin({ email: email.trim(), password })
        : await api.resetAdminPassword(admin.id, { password });
      onDone({ kind: mode, user: result.user, temporaryPassword: result.temporary_password, manual: Boolean(password) });
    } catch (e) {
      setErr(getErrorMessage(e, isAdd ? "Couldn't add the admin." : "Couldn't reset the password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={isAdd ? "Add an admin" : `Reset password for ${admin.email}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="admin-password-form" variant="primary" disabled={busy}>
            {busy ? (isAdd ? "Adding…" : "Resetting…") : isAdd ? "Add admin" : "Reset password"}
          </Button>
        </>
      }
    >
      <form id="admin-password-form" className={styles.form} onSubmit={submit}>
        {err && <Callout tone="error">{err}</Callout>}
        {isAdd ? (
          <Field label="Email" required>
            <Input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
        ) : (
          <p className={styles.dialogNote}>They will be signed out everywhere and can sign in again with the new password.</p>
        )}
        <Field
          label="Password"
          hint={`Optional. Leave blank to generate a temporary password they must change at first sign-in. A password you set here (at least ${MIN_PASSWORD_LENGTH} characters) is theirs to keep.`}
        >
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Generate a temporary password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** The one-time result of adding or resetting: the temporary password, shown once, or a confirmation. */
function ResultNotice({ result, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const { user, temporaryPassword, kind } = result;

  async function copy() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!temporaryPassword) {
    return (
      <Callout tone="success" className={styles.notice} action="Dismiss" onAction={onDismiss}>
        {kind === "add" ? `${user.email} was added and` : `${user.email}`} can sign in with the password you set.
      </Callout>
    );
  }

  return (
    <div className={styles.secretNotice} role="status">
      <p className={styles.secretTitle}>
        Temporary password for <strong>{user.email}</strong>
      </p>
      <div className={styles.secretRow}>
        <code className={styles.secret}>{temporaryPassword}</code>
        <Button size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <p className={styles.secretHint}>
        Share it with them directly. It's shown once, and they'll choose their own password when they sign in.
      </p>
    </div>
  );
}

export default function AdminUsersPage() {
  useDocumentTitle("Admins");
  const { user: me } = useSession();
  const [admins, setAdmins] = useState(null);
  const [err, setErr] = useState("");
  const [dialog, setDialog] = useState(null); // { mode: "add" } | { mode: "reset", admin }
  const [result, setResult] = useState(null);
  const [busyId, setBusyId] = useState("");

  async function load() {
    try {
      const rows = await api.listAdmins();
      setAdmins(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to load admins."));
    }
  }

  useEffect(() => {
    load();
  }, []);

  function finishDialog(next) {
    setDialog(null);
    setResult(next);
    load();
  }

  async function setDisabled(admin, disabled) {
    if (disabled && !window.confirm(`Disable ${admin.email}? They will be signed out everywhere and can't sign in until enabled.`)) {
      return;
    }
    setErr("");
    setBusyId(admin.id);
    try {
      await (disabled ? api.disableAdmin(admin.id) : api.enableAdmin(admin.id));
      await load();
    } catch (e) {
      setErr(getErrorMessage(e, disabled ? "Couldn't disable the admin." : "Couldn't enable the admin."));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Site access"
        title="Admins"
        description="People who can sign in and edit the site. Nobody can create an account on their own."
        actions={
          <Button variant="primary" onClick={() => setDialog({ mode: "add" })}>
            <PlusIcon size={14} />
            Add admin
          </Button>
        }
      />

      {err && (
        <Callout tone="error" className={styles.notice}>
          {err}
        </Callout>
      )}
      {result && <ResultNotice key={result.user.id + result.kind} result={result} onDismiss={() => setResult(null)} />}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {admins === null ? (
              <tr>
                <td colSpan={5} className={styles.placeholder}>
                  Loading admins…
                </td>
              </tr>
            ) : (
              admins.map((admin) => {
                const isMe = admin.id === me?.id;
                const isOwner = admin.role === "owner";
                const disabled = Boolean(admin.disabled_at);
                return (
                  <tr key={admin.id} className={disabled ? styles.rowDisabled : undefined}>
                    <td className={styles.email}>
                      {admin.email}
                      {isMe && <span className={styles.you}>You</span>}
                    </td>
                    <td>
                      <Badge tone={isOwner ? "warning" : "neutral"}>{isOwner ? "Owner" : "Admin"}</Badge>
                    </td>
                    <td className={styles.when}>
                      {formatWhen(admin.last_login_at)}
                      {admin.must_change_password && <span className={styles.sub}>Temporary password</span>}
                    </td>
                    <td>
                      <Badge tone={disabled ? "danger" : "success"}>{disabled ? "Disabled" : "Active"}</Badge>
                    </td>
                    <td>
                      {!isOwner && !isMe && (
                        <div className={styles.rowActions}>
                          <Button size="sm" disabled={busyId === admin.id} onClick={() => setDialog({ mode: "reset", admin })}>
                            Reset password
                          </Button>
                          <Button
                            size="sm"
                            variant={disabled ? "secondary" : "danger"}
                            disabled={busyId === admin.id}
                            onClick={() => setDisabled(admin, !disabled)}
                          >
                            {busyId === admin.id ? "Saving…" : disabled ? "Enable" : "Disable"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {dialog && (
        <PasswordDialog
          key={dialog.mode + (dialog.admin?.id || "")}
          mode={dialog.mode}
          admin={dialog.admin}
          onClose={() => setDialog(null)}
          onDone={finishDialog}
        />
      )}
    </div>
  );
}
