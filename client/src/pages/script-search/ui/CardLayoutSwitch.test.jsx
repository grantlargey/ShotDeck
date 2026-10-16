import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardLayoutSwitch } from "./CardLayoutSwitch.jsx";

function options() {
  return within(screen.getByRole("radiogroup", { name: "Card preview" })).getAllByRole("radio");
}

describe("the card preview switch", () => {
  it("offers script only and a still over the script, with the chosen one checked", () => {
    render(<CardLayoutSwitch value="script" onChange={() => {}} />);

    expect(options().map((option) => option.textContent)).toEqual(["Script only", "Film still and script"]);
    expect(options().map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("reports the layout picked", () => {
    const onChange = vi.fn();
    render(<CardLayoutSwitch value="script" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Film still and script" }));

    expect(onChange).toHaveBeenCalledWith("split");
  });

  it("puts a real still in the little split card when it has one", () => {
    render(<CardLayoutSwitch value="split" onChange={() => {}} stillUrl="https://media.test/still.jpg" />);

    const split = screen.getByRole("radio", { name: "Film still and script" });
    expect(split.querySelector('[style*="media.test/still.jpg"]')).not.toBeNull();
  });
});
