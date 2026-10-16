import { Navigate, useLocation } from "react-router-dom";

/**
 * The site's addresses said /movies before the library and its films were
 * named. Old links and bookmarks land on the same page under its new address,
 * with their query and hash, so a still or scene deep link still opens.
 */
export function LegacyMoviesRedirect() {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.replace(/^\/movies\/?/, "");
  const to = rest ? `/films/${rest}` : "/library";
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
