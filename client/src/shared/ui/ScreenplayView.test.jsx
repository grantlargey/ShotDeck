import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenplayView } from "./ScreenplayView.jsx";

const DUAL_DIALOGUE = [
  "::: dual-dialogue",
  "### MURRAY FRANKLIN",
  "",
  "> No, I think we've had enough of your jokes--",
  "::: column",
  "### JOKER",
  "",
  "> > (overlapping)",
  ">",
  "> What do you get when you cross a mentally-ill loner",
  "> with a system that abandons him?",
  ":::",
].join("\n");

describe("ScreenplayView simultaneous dialogue", () => {
  it.each(["page", "reader", "card"])("renders both speeches in separate columns in the %s variant", (variant) => {
    render(<ScreenplayView source={DUAL_DIALOGUE} variant={variant} />);

    const group = screen.getByRole("group", { name: "Simultaneous dialogue" });
    expect(group.children).toHaveLength(2);
    const [left, right] = group.children;
    expect(Array.from(left.children, (element) => element.textContent)).toEqual([
      "MURRAY FRANKLIN", "No, I think we've had enough of your jokes--",
    ]);
    expect(Array.from(right.children, (element) => element.textContent)).toEqual([
      "JOKER", "(overlapping)", "What do you get when you cross a mentally-ill loner\nwith a system that abandons him?",
    ]);
    expect(within(left).queryByText("JOKER")).toBeNull();
    expect(within(right).queryByText("MURRAY FRANKLIN")).toBeNull();
  });

  it("treats both columns as one preview element", () => {
    const source = `The audience watches.\n\n${DUAL_DIALOGUE}\n\nThe audience gasps.`;
    const { rerender } = render(<ScreenplayView source={source} maxElements={2} variant="card" />);

    expect(screen.getByRole("group", { name: "Simultaneous dialogue" })).toBeTruthy();
    expect(screen.getByText("MURRAY FRANKLIN")).toBeTruthy();
    expect(screen.getByText("JOKER")).toBeTruthy();
    expect(screen.queryByText("The audience gasps.")).toBeNull();

    rerender(<ScreenplayView source={source} maxElements={1} variant="card" />);
    expect(screen.queryByRole("group", { name: "Simultaneous dialogue" })).toBeNull();
  });

  it("keeps partial dialogue in the correct column when the other speech has finished", () => {
    render(<ScreenplayView source={"::: dual-dialogue\n\n::: column\n> Still speaking.\n:::"} />);
    const group = screen.getByRole("group", { name: "Simultaneous dialogue" });
    expect(group.children[0].textContent).toBe("");
    expect(group.children[1].textContent).toBe("Still speaking.");
  });
});
