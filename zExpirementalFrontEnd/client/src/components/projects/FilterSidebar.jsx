// Composes the My Projects search and filtering controls 
// and reports interaction back to the page controller.
import FilterSection from "./FilterSection";
import SearchBar from "../shared/SearchBar";
import "./FilterSidebar.css";

function FilterSidebar({
  sections = [],
  selectedFilters = {},
  onToggleFilter,
  searchValue = "",
  onSearchChange,
  onSearchSubmit,
  onClearAll,
}) {
  return (
    // This component renders current filter state interactions 
    // back to the page controller through callbacks.
    <aside className="filterSidebar" aria-label="Project filters">
      <SearchBar
        className="filterSidebarSearchBar"
        onChange={onSearchChange}
        onSubmit={onSearchSubmit}
        placeholder="Search projects"
        value={searchValue}
      />

      <div className="filterSidebarHeader">
        <h2 className="filterSidebarTitle">Filter Results</h2>
        <button className="filterSidebarClearButton" onClick={onClearAll} type="button">
          Clear all
        </button>
      </div>

      <div className="filterSidebarList">
        {sections.map((section) => (
          <FilterSection
            key={section.key}
            onToggleFilter={onToggleFilter}
            options={section.options}
            sectionKey={section.key}
            selectedOptions={selectedFilters[section.key] || []}
            title={section.title}
          />
        ))}
      </div>
    </aside>
  );
}

export default FilterSidebar;
