// Renders the landing and discovery screen that surfaces 
// recent projects and routes search into My Projects.
import { Link, useNavigate } from "react-router-dom";
import RecentProjects from "../components/explore/RecentProjects";
import HeroSection from "../components/shared/HeroSection";
import SearchBar from "../components/shared/SearchBar";
import { getRecentMovies } from "../models/movies";
import "./ExplorePage.css";

function ExplorePage({ movies = [] }) {
  const navigate = useNavigate();
  // The model decides what counts as "recently updated";
  // this page turns that data into view props.
  const recentProjects = getRecentMovies(movies);

  const handleSearchSubmit = (query) => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      navigate("/my-projects");
      return;
    }

    navigate(`/my-projects?query=${encodeURIComponent(trimmedQuery)}`);
  };

  const handleOpenProject = (project) => {
    navigate(`/my-projects?query=${encodeURIComponent(project.title)}`);
  };

  return (
    <main className="explorePage">
      <HeroSection>
        <div className="explorePageHeroContent">
          <h1 className="explorePageHeroTitle">Read Between The Lines.</h1>

          <p className="explorePageHeroSubtitle">
            Analyze scripts, annotate scenes, and experience storytelling patterns
          </p>

          <div className="explorePageHeroActions">
            <Link className="explorePageHeroButton explorePageHeroButtonPrimary" to="/create-project">
              Start New Project
            </Link>

            <Link className="explorePageHeroButton explorePageHeroButtonSecondary" to="/my-projects">
              Browse Projects
            </Link>
          </div>
        </div>
      </HeroSection>

      <div className="explorePageContent">
        <RecentProjects onOpenProject={handleOpenProject} projects={recentProjects} />

        <div className="explorePageSearch">
          <SearchBar
            onSubmit={handleSearchSubmit}
            placeholder="Search by film, director, writer, or genre..."
          />
        </div>
      </div>
    </main>
  );
}

export default ExplorePage;
