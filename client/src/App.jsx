import { Routes, Route, Navigate } from "react-router-dom";
import SiteHeader from "./components/SiteHeader";
import MoviesListPage from "./pages/MoviesListPage";
import MovieFormPage from "./pages/MovieFormPage";
import MovieDetailPage from "./pages/MovieDetailPage";
import HomePage from "./pages/HomePage";
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
        </Routes>
      </main>
    </>
  );
}