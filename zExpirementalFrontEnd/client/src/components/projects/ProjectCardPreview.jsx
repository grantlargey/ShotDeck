// Shows the compact project card used in grids and can 
// open the expanded project detail modal.
import { useState } from "react";
import ProjectCardExpanded from "./ProjectCardExpanded";
import "./ProjectCardPreview.css";

function ProjectCardPreview({
  movie,
  onOpenClick,
  onEditMovie,
  onDeleteMovie,
}) {
  // My Projects uses the built-in modal; Explore reuses the footer button
  // to hand navigation back to the page controller.
  const [isExpanded, setIsExpanded] = useState(false);

  const handleExpand = () => {
    setIsExpanded(true);
  };

  const handleImageClick = () => {
    handleExpand();
  };

  const handleOpenClick = () => {
    if (onOpenClick) {
      onOpenClick(movie);
      return;
    }

    handleExpand();
  };

  const handleEditMovie = (selectedMovie) => {
    setIsExpanded(false);
    onEditMovie?.(selectedMovie);
  };

  const handleDeleteMovie = (selectedMovie) => {
    setIsExpanded(false);
    onDeleteMovie?.(selectedMovie);
  };

  const handleCloseExpanded = () => {
    setIsExpanded(false);
  };

  return (
    <>
      <article className="projectCardPreview">
        <button
          aria-label={`Open ${movie.title} preview`}
          className="projectCardPreviewImageButton"
          onClick={handleImageClick}
          type="button"
        >
          <div className="projectCardPreviewMedia">
            {movie.coverImage ? (
              <img
                alt={`${movie.title} cover`}
                className="projectCardPreviewImage"
                loading="lazy"
                src={movie.coverImage}
              />
            ) : null}

            <div className="projectCardPreviewOverlay">
              <h3 className="projectCardPreviewTitle">{movie.title}</h3>
              <p className="projectCardPreviewDirector">{movie.director}</p>
            </div>
          </div>
        </button>

        <div className="projectCardPreviewFooter">
          <button className="projectCardPreviewAction" onClick={handleOpenClick} type="button">
            Open Project
          </button>
        </div>
      </article>

      {/* The expanded card acts like a detail view for the selected movie. */}
      <ProjectCardExpanded
        isOpen={isExpanded}
        movie={movie}
        onClose={handleCloseExpanded}
        onDeleteMovie={onDeleteMovie ? handleDeleteMovie : undefined}
        onEditMovie={onEditMovie ? handleEditMovie : undefined}
      />
    </>
  );
}

export default ProjectCardPreview;
