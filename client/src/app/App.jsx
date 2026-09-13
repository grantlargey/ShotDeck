import { lazy, Suspense } from "react";
import { matchPath, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { MovieDetailPage } from "@/pages/movie-detail";
import { MovieFormPage } from "@/pages/movie-form";
import { MoviesListPage } from "@/pages/movies-list";
import { ScriptSearchPage } from "@/pages/script-search";
import { LoadingState } from "@/shared/ui";
import { SiteHeader } from "@/widgets/site-header";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { RequireAdmin } from "./RequireAdmin.jsx";
import page from "./styles/page.module.css";

// Load the PDF renderer and editor when their route is opened.
const ScriptViewerPage = lazy(() =>
  import("@/pages/script-viewer").then((module) => ({ default: module.ScriptViewerPage }))
);
// Only the owner opens this, so visitors never download it.
const AdminUsersPage = lazy(() =>
  import("@/pages/admin-users").then((module) => ({ default: module.AdminUsersPage }))
);

const SCRIPT_VIEWER_PATH = "/movies/:movieId/scripts/:scriptId";
const FULL_BLEED_PATHS = ["/", "/script-search", SCRIPT_VIEWER_PATH];

export default function App() {
  const { pathname } = useLocation();
  // The project page draws its own full-width hero; "/movies/new" also matches ":id".
  const isProjectPage = pathname !== "/movies/new" && Boolean(matchPath("/movies/:id", pathname));
  const isFullBleed = isProjectPage || FULL_BLEED_PATHS.some((path) => matchPath(path, pathname));
  const mainClassName = isFullBleed ? page.mainFullBleed : page.main;
  // The script viewer brings its own compact bar so the script gets the height.
  const showSiteHeader = !matchPath(SCRIPT_VIEWER_PATH, pathname);

  return (
    <>
      {showSiteHeader && <SiteHeader />}

      <main className={mainClassName}>
        <ErrorBoundary resetKey={pathname}>
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
        </ErrorBoundary>
      </main>
    </>
  );
}
