import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchTag } from "./SearchTag.jsx";

afterEach(() => {
  delete HTMLElement.prototype.animate;
});

describe("the search tag", () => {
  it("shows the description, reopens it for editing, and clears the search", () => {
    const onEdit = vi.fn();
    const onClear = vi.fn();
    render(<SearchTag query="a fight on the subway" onEdit={onEdit} onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "“a fight on the subway”" }));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("says it's busy while results load", () => {
    const { container, rerender } = render(<SearchTag query="a fight" searching />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    rerender(<SearchTag query="a fight" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("flies in from the field it was searched in, once, measured on the next frame", async () => {
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate;
    const onFlown = vi.fn();
    render(
      <SearchTag query="a fight" flyFrom={{ left: 600, top: 80, width: 400, height: 36 }} onFlown={onFlown} />
    );

    expect(onFlown).toHaveBeenCalledTimes(1);
    expect(animate).not.toHaveBeenCalled();
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(animate).toHaveBeenCalledTimes(1);
    // jsdom has no layout, so the tag measures 0 × 0 at the origin: it starts level with the field's middle.
    const [frames] = animate.mock.calls[0];
    expect(frames[0].transform).toBe("translate(600px, 98px) scale(0.94)");
  });
});
