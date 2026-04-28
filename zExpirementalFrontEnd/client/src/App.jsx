// Composes the app shell by loading shared state once and routing 
// that data into each page controller.
import { Route, Routes } from "react-router-dom";
import SiteHeader from "./components/layout/SiteHeader";
import useMoviesStore from "./hooks/useMoviesStore";
import CreateProjectPage from "./pages/CreateProjectPage";
import ExplorePage from "./pages/ExplorePage";
import MyProjectsPage from "./pages/MyProjectsPage";

function App() {
  // The movie store owns persistence,
  // and the route pages act as controllers for each screen.
  const { movies, createMovie, updateMovie, deleteMovie } = useMoviesStore();

  return (
    <>
      <SiteHeader />

      <Routes>
        <Route path="/" element={<ExplorePage movies={movies} />} />
        <Route path="/explore" element={<ExplorePage movies={movies} />} />
        <Route
          path="/my-projects"
          element={<MyProjectsPage movies={movies} onDeleteMovie={deleteMovie} />}
        />
        <Route
          path="/create-project"
          element={
            <CreateProjectPage
              movies={movies}
              onCreateMovie={createMovie}
              onUpdateMovie={updateMovie}
            />
          }
        />
      </Routes>
    </>
  );
}

export default App;
