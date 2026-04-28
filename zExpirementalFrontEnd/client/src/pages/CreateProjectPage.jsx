// Owns the create/edit project workflow and translates 
// form state into the normalized movie data shape.
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import { Button, MenuItem, TextField } from "@mui/material";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getMovieById } from "../models/movies";
import "./CreateProjectPage.css";

const genreOptions = [
  "Adventure",
  "Crime",
  "Drama",
  "Historical Thriller",
  "Music",
  "Musical",
  "Neo-Noir",
  "Period Drama",
  "Romance",
  "Sci-Fi",
  "Thriller",
];

const ratingOptions = ["G", "PG", "PG-13", "R", "NC-17", "Unrated"];

const selectMenuProps = {
  PaperProps: {
    sx: {
      border: "1px solid rgba(255, 255, 255, 0.12)",
      borderRadius: "14px",
      backgroundColor: "rgba(15, 18, 29, 0.96)",
      color: "#ffffff",
      backdropFilter: "blur(16px)",
      boxShadow: "0 22px 44px rgba(4, 7, 18, 0.42)",
    },
  },
};

const sharedInputProps = {
  className: "createProjectPageInput",
  fullWidth: true,
  size: "small",
  variant: "outlined",
};

const titleField = {
  fieldName: "title",
  label: "Title",
  placeholder: "Enter movie title...",
  required: true,
};

// The form layout is data-driven so new fields can be added here
// without duplicating the same TextField markup below.
const primaryFieldRows = [
  [
    {
      fieldName: "director",
      label: "Director",
      placeholder: "Enter director's name...",
    },
    {
      fieldName: "runtime",
      label: "Runtime",
      placeholder: "HH:MM:SS",
    },
  ],
  [
    {
      fieldName: "cinematographer",
      label: "Cinematographer",
      placeholder: "Enter cinematographer's name...",
    },
    {
      fieldName: "genre",
      label: "Genre",
      options: genreOptions,
    },
  ],
  [
    {
      fieldName: "writer",
      label: "Writer",
      placeholder: "Enter writer name...",
    },
    {
      fieldName: "rating",
      label: "Rating",
      options: ratingOptions,
    },
  ],
];

const resourceFields = [
  {
    fieldName: "wiki",
    label: "Wiki",
    placeholder: "https://example.com/wiki...",
  },
  {
    fieldName: "script",
    label: "Script",
    placeholder: "https://example.com/script...",
  },
  {
    fieldName: "trailer",
    label: "Trailer",
    placeholder: "https://example.com/trailer...",
  },
];

function createEmptyForm() {
  return {
    title: "",
    director: "",
    runtime: "",
    cinematographer: "",
    genre: "",
    writer: "",
    rating: "",
    wiki: "",
    script: "",
    trailer: "",
    coverImage: "",
  };
}

function mapMovieToForm(movie) {
  return {
    title: movie?.title || "",
    director: movie?.director || "",
    runtime: movie?.runtime || "",
    cinematographer: movie?.cinematographer || "",
    genre: Array.isArray(movie?.genre) ? movie.genre[0] || "" : movie?.genre || "",
    writer: movie?.writer || "",
    rating: movie?.rating || "",
    wiki: movie?.wiki || movie?.wikipedia || "",
    script: movie?.script || "",
    trailer: movie?.trailer || "",
    coverImage: movie?.coverImage || "",
  };
}

function createFieldId(fieldName) {
  return `create-project-${fieldName}`;
}

// Create and edit both submit the same normalized payload shape.
function createMoviePayload(formValues, editingMovie) {
  const trimmedTitle = formValues.title.trim();

  if (!trimmedTitle) {
    return null;
  }

  return {
    title: trimmedTitle,
    director: formValues.director.trim(),
    runtime: formValues.runtime.trim(),
    cinematographer: formValues.cinematographer.trim(),
    genre: formValues.genre ? [formValues.genre] : [],
    writer: formValues.writer.trim(),
    rating: formValues.rating,
    wiki: formValues.wiki.trim(),
    script: formValues.script.trim(),
    trailer: formValues.trailer.trim(),
    coverImage: formValues.coverImage || editingMovie?.coverImage || "",
    releaseDate: editingMovie?.releaseDate || new Date().toISOString().slice(0, 10),
  };
}

function FieldLabel({ children, description, htmlFor }) {
  if (htmlFor) {
    return (
      <div className="createProjectPageLabelRow">
        <label className="createProjectPageLabel" htmlFor={htmlFor}>
          {children}
        </label>

        {description ? (
          <span className="createProjectPageLabelDescription">{description}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="createProjectPageLabelRow">
      <div className="createProjectPageLabel">{children}</div>

      {description ? (
        <span className="createProjectPageLabelDescription">{description}</span>
      ) : null}
    </div>
  );
}

// Most inputs share the same label + MUI field wiring, so this wrapper
// keeps the main form JSX focused on layout.
function ProjectFormField({
  description,
  fieldName,
  label,
  onChange,
  options,
  placeholder,
  required = false,
  value,
}) {
  const fieldId = createFieldId(fieldName);
  const isSelect = Boolean(options);

  return (
    <div className="createProjectPageField">
      <FieldLabel description={description} htmlFor={fieldId}>
        {label}
      </FieldLabel>

      <TextField
        {...sharedInputProps}
        id={fieldId}
        onChange={onChange(fieldName)}
        placeholder={isSelect ? undefined : placeholder}
        required={required}
        value={value}
        {...(isSelect
          ? {
              select: true,
              SelectProps: { MenuProps: selectMenuProps },
            }
          : {})}
      >
        {isSelect ? (
          <>
            <MenuItem value="">{`Select ${label.toLowerCase()}...`}</MenuItem>
            {options.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </>
        ) : null}
      </TextField>
    </div>
  );
}

function CoverImageField({ coverImage, onChange }) {
  const inputId = createFieldId("cover-input");

  return (
    <div className="createProjectPageField">
      <FieldLabel htmlFor={inputId}>Cover</FieldLabel>

      {/* The visible card acts as the upload trigger for the hidden file input. */}
      <input
        accept="image/*"
        className="createProjectPageUploadInput"
        id={inputId}
        onChange={onChange}
        type="file"
      />

      <label
        className={`createProjectPageUploadCard${
          coverImage ? " createProjectPageUploadCardFilled" : ""
        }`}
        htmlFor={inputId}
      >
        {coverImage ? (
          <>
            <img
              alt="Selected project cover preview"
              className="createProjectPageUploadPreview"
              src={coverImage}
            />
            <p className="createProjectPageUploadMeta">Click to replace cover image</p>
          </>
        ) : (
          <>
            <CloudUploadOutlinedIcon className="createProjectPageUploadIcon" />
            <p className="createProjectPageUploadTitle">Click to upload a cover image</p>
            <p className="createProjectPageUploadMeta">
              JPG or PNG, stored locally in your browser
            </p>
          </>
        )}
      </label>
    </div>
  );
}

function ProjectEditorForm({ editingMovie, onCreateMovie, onUpdateMovie }) {
  const navigate = useNavigate();
  const isEditing = Boolean(editingMovie);
  // The outer keyed wrapper remounts this form when the edited movie changes.
  const [formValues, setFormValues] = useState(() =>
    isEditing ? mapMovieToForm(editingMovie) : createEmptyForm(),
  );

  const handleFieldChange = (fieldName) => (event) => {
    const nextValue = event.target.value;

    setFormValues((currentValues) => ({
      ...currentValues,
      [fieldName]: nextValue,
    }));
  };

  const handleCoverImageChange = (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    // Stores the uploaded image as a local data URL so the project
    // still works in a client-only app without a backend upload service.
    const fileReader = new FileReader();

    fileReader.onload = () => {
      setFormValues((currentValues) => ({
        ...currentValues,
        coverImage: typeof fileReader.result === "string" ? fileReader.result : "",
      }));
    };

    fileReader.readAsDataURL(selectedFile);
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const moviePayload = createMoviePayload(formValues, editingMovie);

    if (!moviePayload) {
      return;
    }

    if (isEditing) {
      onUpdateMovie?.(editingMovie.id, moviePayload);
    } else {
      onCreateMovie?.(moviePayload);
    }

    navigate("/my-projects");
  };

  return (
    <main className="createProjectPage">
      <div className="createProjectPageInner">
        <section className="createProjectPagePanel" aria-labelledby="create-project-panel-title">
          <div className="createProjectPagePanelHeader">
            <h2 className="createProjectPagePanelTitle" id="create-project-panel-title">
              {isEditing ? "Update Project" : "Create New Project"}
            </h2>
          </div>

          <form className="createProjectPageForm" onSubmit={handleSubmit}>
            <div className="createProjectPageFormGrid">
              <div className="createProjectPageFormColumn createProjectPageFormColumnPrimary">
                <ProjectFormField
                  {...titleField}
                  onChange={handleFieldChange}
                  value={formValues[titleField.fieldName]}
                />

                {/* These row definitions preserve the two-column layout while
                    letting the field list live near the other form config. */}
                {primaryFieldRows.map((fieldRow) => (
                  <div
                    className="createProjectPageFieldPair"
                    key={fieldRow.map(({ fieldName }) => fieldName).join("-")}
                  >
                    {fieldRow.map((field) => (
                      <ProjectFormField
                        {...field}
                        key={field.fieldName}
                        onChange={handleFieldChange}
                        value={formValues[field.fieldName]}
                      />
                    ))}
                  </div>
                ))}
              </div>

              <div className="createProjectPageFormColumn createProjectPageFormColumnSecondary">
                <CoverImageField
                  coverImage={formValues.coverImage}
                  onChange={handleCoverImageChange}
                />

                {resourceFields.map((field) => (
                  <ProjectFormField
                    {...field}
                    key={field.fieldName}
                    onChange={handleFieldChange}
                    value={formValues[field.fieldName]}
                  />
                ))}
              </div>
            </div>

            <div className="createProjectPageActions">
              <Button
                className="createProjectPageActionButton createProjectPageActionButtonSecondary"
                onClick={() => navigate("/my-projects")}
                type="button"
                variant="outlined"
              >
                Cancel
              </Button>

              <Button
                className="createProjectPageActionButton createProjectPageActionButtonPrimary"
                disableElevation
                type="submit"
                variant="contained"
              >
                {isEditing ? "Update Project" : "Save Project"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function CreateProjectPage({ movies = [], onCreateMovie, onUpdateMovie }) {
  const [searchParams] = useSearchParams();
  const editingMovieId = searchParams.get("edit");
  // Create and edit share the same form. Keying the form remounts it whenever
  // the selected project changes, which resets local draft state without an effect.
  const editingMovie = getMovieById(movies, editingMovieId);

  return (
    <ProjectEditorForm
      key={editingMovie?.id || "new-project"}
      editingMovie={editingMovie}
      onCreateMovie={onCreateMovie}
      onUpdateMovie={onUpdateMovie}
    />
  );
}

export default CreateProjectPage;
