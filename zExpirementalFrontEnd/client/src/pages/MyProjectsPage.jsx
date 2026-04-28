// Acts as the project library controller by coordinating search, 
// filters, sorting, and edit/delete actions.
import { FormControl, MenuItem, Select } from "@mui/material";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import FilterSidebar from "../components/projects/FilterSidebar";
import ProjectGrid from "../components/projects/ProjectGrid";
import {
  DEFAULT_MOVIE_SORT,
  getFilterSections,
  getVisibleMovies,
} from "../models/movies";
import "./MyProjectsPage.css";

const sortOptions = [
  { value: "title-asc", label: "Title (A-Z)" },
  { value: "title-desc", label: "Title (Z-A)" },
  { value: "release-newest", label: "Release (Newest)" },
  { value: "release-oldest", label: "Release (Oldest)" },
  { value: "recently-updated", label: "Recently Updated" },
];

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

function createEmptySelectedFilters() {
  // Returning a fresh object avoids sharing one mutable reference
  // when the user clears filters multiple times.
  return {
    director: [],
    cinematographer: [],
    writer: [],
    genre: [],
    rating: [],
  };
}

function MyProjectsPage({ movies = [], onDeleteMovie }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState(DEFAULT_MOVIE_SORT);
  const [selectedFilters, setSelectedFilters] = useState(createEmptySelectedFilters);
  const searchValue = searchParams.get("query") || "";

  const filterSections = getFilterSections(movies);
  const filteredProjects = getVisibleMovies(movies, {
    query: searchValue,
    selectedFilters,
    sortBy,
  });

  const updateQueryParam = (nextQuery) => {
    // Keep the search term in the URL so the page is refresh-safe
    // and can also be reached from Explore with a prefilled search.
    const nextSearchParams = new URLSearchParams(searchParams);

    if (nextQuery) {
      nextSearchParams.set("query", nextQuery);
    } else {
      nextSearchParams.delete("query");
    }

    setSearchParams(nextSearchParams, { replace: true });
  };

  const handleSearchChange = (nextValue) => {
    updateQueryParam(nextValue);
  };

  const handleSearchSubmit = (nextValue) => {
    updateQueryParam(nextValue.trim());
  };

  const handleToggleFilter = (filterKey, option) => {
    setSelectedFilters((currentFilters) => {
      const currentValues = currentFilters[filterKey] || [];
      const nextValues = currentValues.includes(option)
        ? currentValues.filter((value) => value !== option)
        : [...currentValues, option];

      return {
        ...currentFilters,
        [filterKey]: nextValues,
      };
    });
  };

  const handleClearAll = () => {
    setSelectedFilters(createEmptySelectedFilters());
    updateQueryParam("");
  };

  const handleEditMovie = (movie) => {
    navigate(`/create-project?edit=${encodeURIComponent(movie.id)}`);
  };

  const handleDeleteSelectedMovie = (movie) => {
    const shouldDelete = window.confirm(`Delete "${movie.title}" from your projects?`);

    if (!shouldDelete) {
      return;
    }

    onDeleteMovie?.(movie.id);
  };

  return (
    <main className="myProjectsPage">
      <div className="myProjectsPageInner">
        <div className="myProjectsPageLayout">
          <FilterSidebar
            onClearAll={handleClearAll}
            onSearchChange={handleSearchChange}
            onSearchSubmit={handleSearchSubmit}
            onToggleFilter={handleToggleFilter}
            searchValue={searchValue}
            sections={filterSections}
            selectedFilters={selectedFilters}
          />

          <section className="myProjectsPageMain">
            <div className="myProjectsPageMainHeader">
              <div className="myProjectsPageHeadingGroup">
                <h1 className="myProjectsPageTitle">My Projects</h1>
                <p className="myProjectsPageSubtitle">
                  Showing {filteredProjects.length} projects
                </p>
              </div>

              <div className="myProjectsPageSort">
                <span className="myProjectsPageSortLabel">Sort By</span>

                <FormControl className="myProjectsPageSortField" size="small">
                  <Select
                    displayEmpty
                    inputProps={{ "aria-label": "Sort projects" }}
                    MenuProps={selectMenuProps}
                    onChange={(event) => setSortBy(event.target.value)}
                    value={sortBy}
                  >
                    {sortOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </div>
            </div>

            <ProjectGrid
              onDeleteMovie={handleDeleteSelectedMovie}
              onEditMovie={handleEditMovie}
              projects={filteredProjects}
            />
          </section>
        </div>
      </div>
    </main>
  );
}

export default MyProjectsPage;
