import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFocusKeys } from "./useFocusKeys.js";

function Keys(props) {
  useFocusKeys(props);
  return <input aria-label="Field" />;
}

describe("useFocusKeys", () => {
  it("turns focus on and off with F, and leaves it with Esc", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Keys focused={false} onChange={onChange} />);
    fireEvent.keyDown(window, { key: "f" });
    expect(onChange).toHaveBeenLastCalledWith(true);

    // Esc only means something while focus is on.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(<Keys focused onChange={onChange} />);
    fireEvent.keyDown(window, { key: "F" });
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("takes Esc before the page's own listeners hear it", () => {
    const later = vi.fn();
    window.addEventListener("keydown", later);
    render(<Keys focused onChange={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(later).toHaveBeenCalledWith(expect.objectContaining({ defaultPrevented: true }));
    window.removeEventListener("keydown", later);
  });

  it("leaves typing, shortcuts with modifiers and an unavailable focus alone", () => {
    const onChange = vi.fn();
    const { getByLabelText, rerender } = render(<Keys focused={false} onChange={onChange} />);
    fireEvent.keyDown(getByLabelText("Field"), { key: "f" });
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    fireEvent.keyDown(window, { key: "f", repeat: true });
    rerender(<Keys focused={false} canFocus={false} onChange={onChange} />);
    fireEvent.keyDown(window, { key: "f" });
    rerender(<Keys enabled={false} focused onChange={onChange} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
