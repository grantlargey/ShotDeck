import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFilterGroups } from "../model/sceneBrowse.js";
import FilterSidebar from "./FilterSidebar.jsx";

function Sidebar(props) {
  return (
    <FilterSidebar
      groups={buildFilterGroups()}
      tagCounts={new Map()}
      selectedTags={[]}
      match="all"
      open={false}
      docked
      folded={false}
      motion={null}
      onClose={() => {}}
      onFold={() => {}}
      onUnfold={() => {}}
      onToggleTag={() => {}}
      onMatchChange={() => {}}
      onClear={() => {}}
      {...props}
    />
  );
}

describe("FilterSidebar's book button", () => {
  it("folds the docked panel away", () => {
    const onFold = vi.fn();
    render(<Sidebar onFold={onFold} />);
    fireEvent.click(screen.getByRole("button", { name: "Fold the filters away" }));
    expect(onFold).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Close filters" })).toBeNull();
  });

  it("closes the drawer from beside Clear all on narrow screens", () => {
    const onClose = vi.fn();
    render(<Sidebar docked={false} open onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close filters" });
    expect(close.getAttribute("aria-expanded")).toBe("true");
    expect(close.parentElement).toBe(screen.getByRole("button", { name: "Clear all" }).parentElement);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Fold the filters away" })).toBeNull();
  });
});
