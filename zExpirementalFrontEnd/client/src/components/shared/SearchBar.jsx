// Provides a reusable search form that can operate in controlled 
// or uncontrolled mode across pages.
import { useState } from "react";
import SearchIcon from "@mui/icons-material/Search";
import "./SearchBar.css";

function SearchBar({
  placeholder,
  name = "query",
  className = "",
  onChange,
  onSubmit,
  value,
}) {
  // The shared search bar supports both uncontrolled use
  // (like Explore) and controlled use (like the filter sidebar).
  const isControlled = value !== undefined;
  const [query, setQuery] = useState("");
  const searchBarClassName = ["searchBar", className].filter(Boolean).join(" ");
  const currentValue = isControlled ? value : query;

  const handleChange = (event) => {
    const nextValue = event.target.value;

    if (!isControlled) {
      setQuery(nextValue);
    }

    onChange?.(nextValue);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(currentValue);
  };

  return (
    <form className={searchBarClassName} onSubmit={handleSubmit} role="search">
      <input
        aria-label="Search"
        autoComplete="off"
        className="searchBarInput"
        name={name}
        onChange={handleChange}
        placeholder={placeholder}
        type="search"
        value={currentValue}
      />

      <button aria-label="Submit search" className="searchBarButton" type="submit">
        <SearchIcon fontSize="large" />
      </button>
    </form>
  );
}

export default SearchBar;
