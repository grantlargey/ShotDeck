import { useCallback, useEffect, useMemo, useState } from "react";
import { api, markSessionActive, SESSION_EXPIRED_EVENT } from "@/shared/api";
import { SessionContext } from "./sessionContext.js";

/**
 * Resolves the current admin from the API's session cookie once per page load
 * and shares it with the whole app. Visitors have no session and get the
 * read-only site; a signed-in admin gets the editing controls. Until the API
 * has answered, `ready` is false and pages render the visitor view, so a
 * visitor never sees admin controls flash.
 */
export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getSession()
      .then(({ user: current }) => {
        if (cancelled) return;
        markSessionActive(Boolean(current));
        setUser(current ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A write refused after sign-in means the session ended on the server.
  useEffect(() => {
    function onExpired() {
      setUser(null);
      setExpired(true);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const applyUser = useCallback((next) => {
    markSessionActive(Boolean(next));
    setUser(next ?? null);
    setExpired(false);
  }, []);

  const signIn = useCallback(
    async (email, password) => {
      const { user: next } = await api.login(email, password);
      applyUser(next);
      return next;
    },
    [applyUser]
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      applyUser(null);
    }
  }, [applyUser]);

  const value = useMemo(
    () => ({
      user,
      ready,
      expired,
      isAdmin: Boolean(user),
      isOwner: user?.role === "owner",
      signIn,
      signOut,
      applyUser,
    }),
    [user, ready, expired, signIn, signOut, applyUser]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
