// Presents the full project detail modal with metadata, 
// resource links, and optional management actions.
import { formatMovieReleaseYear, getMovieResourceLinks } from "../../models/movies";
import "./ProjectCardExpanded.css";

function ProjectCardExpanded({
  isOpen = true,
  movie,
  onClose,
  onDeleteMovie,
  onEditMovie,
}) {
  // Keeping the early return here makes the modal easy to drop into a card
  // without adding extra conditional rendering logic around it.
  if (!isOpen) {
    return null;
  }

  const releaseYear = formatMovieReleaseYear(movie.releaseDate);
  const resourceLinks = getMovieResourceLinks(movie);
  const hasActions = resourceLinks.length || onEditMovie || onDeleteMovie;
  const metadataItems = [
    { label: "Director", value: movie.director },
    { label: "Runtime", value: movie.runtime },
    { label: "Cinematographer", value: movie.cinematographer },
    {
      label: "Genre",
      value: Array.isArray(movie.genre) ? movie.genre.filter(Boolean).join(", ") : movie.genre,
    },
    { label: "Writer", value: movie.writer },
    { label: "Rating", value: movie.rating },
  ].filter((item) => item.value);
  const hasBody = metadataItems.length || hasActions;

  return (
    <div className="projectCardExpandedOverlay" role="presentation">
      <section
        aria-labelledby="project-card-expanded-title"
        aria-modal="true"
        className="projectCardExpanded"
        role="dialog"
      >
        <div className="projectCardExpandedHeader">
          <h2 className="projectCardExpandedTitle" id="project-card-expanded-title">
            {movie.title}
            {releaseYear ? (
              <span className="projectCardExpandedYear">({releaseYear})</span>
            ) : null}
          </h2>

          <button className="projectCardExpandedClose" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="projectCardExpandedImageFrame">
          {movie.coverImage ? (
            <img alt={`${movie.title} cover`} className="projectCardExpandedImage" src={movie.coverImage} />
          ) : null}
        </div>

        {hasBody ? (
          <div className="projectCardExpandedBody">
            {metadataItems.length ? (
              // A definition list works well here because this is mostly labeled metadata.
              <dl className="projectCardExpandedMeta">
                {metadataItems.map((item) => (
                  <div className="projectCardExpandedMetaItem" key={item.label}>
                    <dt>{item.label}:</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {hasActions ? (
              <div className="projectCardExpandedActions">
                {/* These links are read-only project resources.
                    Edit/delete are only shown on pages that manage the dataset. */}
                {resourceLinks.map((resourceLink) => (
                  <a
                    className="projectCardExpandedLink"
                    href={resourceLink.href}
                    key={resourceLink.key}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {resourceLink.label}
                  </a>
                ))}

                {onEditMovie ? (
                  <button
                    className="projectCardExpandedControl"
                    onClick={() => onEditMovie(movie)}
                    type="button"
                  >
                    Edit Project
                  </button>
                ) : null}

                {onDeleteMovie ? (
                  <button
                    className="projectCardExpandedControl projectCardExpandedControlDanger"
                    onClick={() => onDeleteMovie(movie)}
                    type="button"
                  >
                    Delete Project
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default ProjectCardExpanded;
