import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "@/entities/session";
import { LoadingState } from "@/shared/ui";

/**
 * Wraps routes only admins may open. Visitors are sent to sign in and come
 * back to the same URL afterwards. With `owner`, admins who aren't the owner
 * are sent home instead.
 */
export function RequireAdmin({ owner = false, children }) {
  const { ready, isAdmin, isOwner } = useSession();
  const { pathname, search } = useLocation();

  if (!ready) return <LoadingState>Checking your sign-in…</LoadingState>;
  if (!isAdmin) {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  }
  if (owner && !isOwner) return <Navigate to="/" replace />;
  return children;
}
