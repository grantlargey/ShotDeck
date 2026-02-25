import { Routes, Route, Navigate, Link } from "react-router-dom";
import MoviesListPage from "./pages/MoviesListPage";
import MovieFormPage from "./pages/MovieFormPage";
import MovieDetailPage from "./pages/MovieDetailPage";

export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Movie Annotator</h2>
        <nav style={{ display: "flex", gap: 12 }}>
          <Link to="/movies">Archive</Link>
          <Link to="/movies/new">Create Movie</Link>
        </nav>
      </header>

      <hr />

      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route path="/movies" element={<MoviesListPage />} />
        <Route path="/movies/new" element={<MovieFormPage mode="create" />} />
        <Route path="/movies/:id/edit" element={<MovieFormPage mode="edit" />} />
        <Route path="/movies/:id" element={<MovieDetailPage />} />
      </Routes>
    </div>
  );
}