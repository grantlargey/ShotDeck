import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "./SegmentedControl.jsx";

const OPTIONS = [
  { value: "script", label: "Script" },
  { value: "still", label: "Film still" },
];

describe("the segmented control", () => {
  it("draws no separate highlight unless asked to slide", () => {
    const { container } = render(<SegmentedControl label="Scene view" options={OPTIONS} value="script" onChange={() => {}} />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("can slide one highlight between options, keeping them a radio group", () => {
    const { container } = render(
      <SegmentedControl label="Scene view" options={OPTIONS} value="still" onChange={() => {}} sliding />
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Film still" }).getAttribute("aria-checked")).toBe("true");
  });
});
