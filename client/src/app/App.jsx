import { Routes, Route, Navigate } from "react-router-dom";
import { HomePage } from "@/pages/home";
import { MovieDetailPage } from "@/pages/movie-detail";
import { MovieFormPage } from "@/pages/movie-form";
import { MoviesListPage } from "@/pages/movies-list";
import { ScriptSearchPage } from "@/pages/script-search";
import { ScriptViewerPage } from "@/pages/script-viewer";
import { SiteHeader } from "@/widgets/site-header";
import page from "./styles/page.module.css";

export default function App() {
  return (
    <>
      <SiteHeader />

      <main className={page.main}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/movies" element={<MoviesListPage />} />
          <Route path="/movies/new" element={<MovieFormPage mode="create" />} />
          <Route path="/movies/:id/edit" element={<MovieFormPage mode="edit" />} />
          <Route path="/movies/:id" element={<MovieDetailPage />} />
          <Route path="/movies/:movieId/scripts/:scriptId" element={<ScriptViewerPage />} />
          <Route path="/script-search" element={<ScriptSearchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
