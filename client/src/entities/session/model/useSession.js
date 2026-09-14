import { createContext, useContext } from "react";

/** Provided by SessionProvider; read it through useSession. */
export const SessionContext = createContext(null);

/**
 * Who is using the site: `user` (an admin account or null), `isAdmin`,
 * `isOwner`, `ready` (false until the API has answered once), `expired`
 * (a signed-in session was refused mid-visit), and sign-in / sign-out actions.
 */
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession needs a SessionProvider above it.");
  return value;
}
