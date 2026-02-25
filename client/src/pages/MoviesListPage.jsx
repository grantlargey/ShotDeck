import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function MoviesListPage() {
  const [movies, setMovies] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try {
      const data = await api.listMovies();
      setMovies(data);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <h3>Archive</h3>
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      {movies.length === 0 ? (
        <p>No movies yet.</p>
      ) : (
        <ul>
          {movies.map((m) => (
            <li key={m.id} style={{ marginBottom: 8 }}>
              <Link to={`/movies/${m.id}`}>{m.title}</Link>{" "}
              <span style={{ color: "#666" }}>
                ({m.year}) • {m.director}
              </span>{" "}
              <Link to={`/movies/${m.id}/edit`} style={{ marginLeft: 8 }}>
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}