// Lays out the visible project cards for My Projects and 
// owns the empty-state presentation.
import ProjectCardPreview from "./ProjectCardPreview";
import "./ProjectGrid.css";

function ProjectGrid({ projects = [], onDeleteMovie, onEditMovie }) {
  // Filtering/sorting happens in the page controller before projects reach this view.
  if (!projects.length) {
    return (
      <div className="projectGridEmpty">
        <p className="projectGridEmptyTitle">No projects match the current filters.</p>
        <p className="projectGridEmptyCopy">Try clearing filters or searching for a different title.</p>
      </div>
    );
  }

  return (
    <div className="projectGrid">
      {projects.map((project) => (
        <div className="projectGridCard" key={project.id}>
          {/* Each card gets optional edit/delete handlers from My Projects. */}
          <ProjectCardPreview
            movie={project}
            onDeleteMovie={onDeleteMovie}
            onEditMovie={onEditMovie}
          />
        </div>
      ))}
    </div>
  );
}

export default ProjectGrid;
