import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog.jsx";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open && (
        <Dialog title="Example dialog" onClose={() => setOpen(false)}>
          <input aria-label="Example field" />
        </Dialog>
      )}
    </>
  );
}

describe("Dialog lifecycle", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Example dialog" onClose={onClose}>
        Body
      </Dialog>
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop is pressed but not when the panel is pressed", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Example dialog" onClose={onClose}>
        Body
      </Dialog>
    );
    const panel = screen.getByRole("dialog", { name: "Example dialog" });

    fireEvent.mouseDown(panel);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(panel.parentElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("locks page scrolling while mounted and restores the prior value", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = render(
      <Dialog title="Example dialog" onClose={() => {}}>
        Body
      </Dialog>
    );

    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });

  /*
   * The overlay covers the viewport through `position: fixed`, which resolves
   * against the nearest ancestor that paints a backdrop filter rather than
   * against the viewport. The site header paints one, so a dialog left where
   * it is written would collapse to the header's height when opened from the
   * account menu. Drawing it at the end of the document is what keeps it out
   * of any such subtree.
   */
  it("draws itself outside the subtree it was written in", () => {
    const { container } = render(
      <header style={{ backdropFilter: "blur(8px)" }}>
        <Dialog title="Example dialog" onClose={() => {}}>
          Body
        </Dialog>
      </header>
    );
    const panel = screen.getByRole("dialog", { name: "Example dialog" });

    expect(panel.closest("header")).toBeNull();
    expect(container.contains(panel)).toBe(false);
    expect(panel.parentElement.parentElement).toBe(document.body);
  });

  it("restores focus to the opener when it closes", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    opener.focus();
    fireEvent.click(opener);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" })));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(document.activeElement).toBe(opener);
  });
});
