// Displays the recent-project panel on Explore using reusable preview cards.
import { Link } from "react-router-dom";
import ProjectCardPreview from "../projects/ProjectCardPreview";
import "./RecentProjects.css";

function RecentProjects({ projects = [], onOpenProject, viewAllTo = "/my-projects" }) {
  // This component renders the project cards
  // and receives navigation behavior from the page controller.
  return (
    <section className="recentProjects" id="recent-projects" aria-labelledby="recent-projects-heading">
      <div className="recentProjectsHeader">
        <h2 className="recentProjectsTitle" id="recent-projects-heading">
          Recent Projects
        </h2>

        <Link className="recentProjectsViewAll" to={viewAllTo}>
          View All
        </Link>
      </div>

      <div className="recentProjectsGrid">
        {projects.map((project) => (
          <ProjectCardPreview key={project.id} movie={project} onOpenClick={onOpenProject} />
        ))}
      </div>
    </section>
  );
}

export default RecentProjects;
