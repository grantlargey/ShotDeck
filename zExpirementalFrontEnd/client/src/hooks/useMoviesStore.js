// Bridges the UI and the movie model layer by exposing 
// persistent project state and CRUD actions as a hook.
import { useEffect, useState } from "react";
import {
  createMovie,
  deleteMovie,
  loadMovies,
  saveMovies,
  updateMovie,
} from "../models/movies";

function useMoviesStore() {
  // The custom store hook keeps the pages from talking to localStorage directly.
  const [movies, setMovies] = useState(loadMovies);

  useEffect(() => {
    saveMovies(movies);
  }, [movies]);

  const handleCreateMovie = (moviePayload) => {
    setMovies((currentMovies) => createMovie(currentMovies, moviePayload));
  };

  const handleUpdateMovie = (movieId, moviePayload) => {
    setMovies((currentMovies) => updateMovie(currentMovies, movieId, moviePayload));
  };

  const handleDeleteMovie = (movieId) => {
    setMovies((currentMovies) => deleteMovie(currentMovies, movieId));
  };

  return {
    movies,
    createMovie: handleCreateMovie,
    updateMovie: handleUpdateMovie,
    deleteMovie: handleDeleteMovie,
  };
}

export default useMoviesStore;
