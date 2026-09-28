import { lazy, Suspense } from "react";
import { matchPath, Navigate, Route, Routes, useLocation } from "react-router-dom";
import HomePage from "@/pages/home/ui/HomePage.jsx";
import LoginPage from "@/pages/login/ui/LoginPage.jsx";
import MovieDetailPage from "@/pages/movie-detail/ui/MovieDetailPage.jsx";
import MovieFormPage from "@/pages/movie-form/ui/MovieFormPage.jsx";
import MoviesListPage from "@/pages/movies-list/ui/MoviesListPage.jsx";
import ScriptSearchPage from "@/pages/script-search/ui/ScriptSearchPage.jsx";
import { LoadingState } from "@/shared/ui/LoadingState.jsx";
import BackToTop from "@/widgets/back-to-top/ui/BackToTop.jsx";
import SiteFooter from "@/widgets/site-footer/ui/SiteFooter.jsx";
import SiteHeader from "@/widgets/site-header/ui/SiteHeader.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { RequireAdmin } from "./RequireAdmin.jsx";
import { useScrollRestoration } from "./useScrollRestoration.js";
import page from "./styles/page.module.css";

// Load the PDF renderer and editor when their route is opened.
const ScriptViewerPage = lazy(() => import("@/pages/script-viewer/ui/ScriptViewerPage.jsx"));
// Only the owner opens this, so visitors never download it.
const AdminUsersPage = lazy(() => import("@/pages/admin-users/ui/AdminUsersPage.jsx"));

const SCRIPT_VIEWER_PATH = "/movies/:movieId/scripts/:scriptId";
const FULL_BLEED_PATHS = ["/", "/script-search", SCRIPT_VIEWER_PATH];
const MAIN_ID = "main-content";
const SKIP_LINK_ID = "skip-link";

function focusMain(event) {
  const main = document.getElementById(MAIN_ID);
  if (!main) return;
  event.preventDefault();
  main.focus();
}

export default function App() {
  const { pathname } = useLocation();
  useScrollRestoration();
  // The project page draws its own full-width hero; "/movies/new" also matches ":id".
  const isProjectPage = pathname !== "/movies/new" && Boolean(matchPath("/movies/:id", pathname));
  const isFullBleed = isProjectPage || FULL_BLEED_PATHS.some((path) => matchPath(path, pathname));
  const mainClassName = isFullBleed ? page.mainFullBleed : page.main;
  // The script viewer pins its own tool bar, so the site header above it scrolls away.
  const pinHeader = !matchPath(SCRIPT_VIEWER_PATH, pathname);

  return (
    <div className={page.shell}>
      <a id={SKIP_LINK_ID} className={page.skipLink} href={`#${MAIN_ID}`} onClick={focusMain}>
        Skip to content
      </a>

      <SiteHeader pinned={pinHeader} />

      <main id={MAIN_ID} tabIndex={-1} className={mainClassName}>
        <ErrorBoundary resetKey={pathname}>
          {/* Keyed by path so each new page fades in. */}
          <div key={pathname} className={page.routeView}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/movies" element={<MoviesListPage />} />
              <Route
                path="/movies/new"
                element={
                  <RequireAdmin>
                    <MovieFormPage mode="create" />
                  </RequireAdmin>
                }
              />
              <Route
                path="/movies/:id/edit"
                element={
                  <RequireAdmin>
                    <MovieFormPage mode="edit" />
                  </RequireAdmin>
                }
              />
              <Route path="/movies/:id" element={<MovieDetailPage />} />
              <Route
                path={SCRIPT_VIEWER_PATH}
                element={
                  <Suspense fallback={<LoadingState>Loading script viewer…</LoadingState>}>
                    <ScriptViewerPage />
                  </Suspense>
                }
              />
              <Route path="/script-search" element={<ScriptSearchPage />} />
              <Route
                path="/admin/users"
                element={
                  <RequireAdmin owner>
                    <Suspense fallback={<LoadingState>Loading admins…</LoadingState>}>
                      <AdminUsersPage />
                    </Suspense>
                  </RequireAdmin>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </ErrorBoundary>
      </main>

      <SiteFooter />
      <BackToTop focusTargetId={SKIP_LINK_ID} />
    </div>
  );
}
