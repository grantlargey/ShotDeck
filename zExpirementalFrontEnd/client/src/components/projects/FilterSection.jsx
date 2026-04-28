// Renders one collapsible filter group inside the sidebar and 
// wires each option to the shared filter state.
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import { createFilterOptionId } from "../../models/movies";

function FilterSection({ options, selectedOptions, sectionKey, title, onToggleFilter }) {
  // Each section is collapsible so the sidebar stays readable even as
  // the dataset grows and more filter values appear.
  return (
    <details className="filterSidebarSection">
      <summary className="filterSidebarSummary">
        <span>{title}</span>
        <ChevronRightRoundedIcon className="filterSidebarChevron" />
      </summary>

      <div className="filterSidebarOptions">
        {options.length ? (
          options.map((option) => {
            // A stable id keeps the label/input pairing accessible.
            const checkboxId = createFilterOptionId(sectionKey, option);

            return (
              <label className="filterSidebarOption" htmlFor={checkboxId} key={option}>
                <input
                  checked={selectedOptions.includes(option)}
                  className="filterSidebarCheckbox"
                  id={checkboxId}
                  onChange={() => onToggleFilter(sectionKey, option)}
                  type="checkbox"
                />
                <span>{option}</span>
              </label>
            );
          })
        ) : (
          <p className="filterSidebarEmpty">No filters available yet.</p>
        )}
      </div>
    </details>
  );
}

export default FilterSection;
