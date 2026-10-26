import { useEffect, useLayoutEffect, useRef } from "react";
import { isTypingTarget } from "@/shared/lib/keyboard.js";

/**
 * Focused reading's keys: F turns focus on and off, and Esc leaves it. They
 * listen ahead of everything else on the page, so the Esc that leaves focus
 * in a dialog doesn't also close the dialog; the next one does. Keys typed
 * into a field are left alone.
 *
 * enabled: whether the keys apply at all, such as false while a dialog has
 *   the page.
 * focused: whether focus is on.
 * canFocus: whether F may turn it on now.
 * outsideDialogs: ignore keys pressed inside a dialog, for a page whose own
 *   dialogs have keys of their own.
 * onChange(next): turn focus on (true) or off (false).
 */
export function useFocusKeys({ enabled = true, focused, canFocus = true, outsideDialogs = false, onChange }) {
  const latest = useRef({ focused, canFocus, outsideDialogs, onChange });
  useLayoutEffect(() => {
    latest.current = { focused, canFocus, outsideDialogs, onChange };
  });

  useEffect(() => {
    if (!enabled) return undefined;
    function onKeyDown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const current = latest.current;
      if (isTypingTarget(event.target, { withinDialog: current.outsideDialogs })) return;
      if (event.key === "Escape") {
        if (!current.focused) return;
        event.preventDefault();
        current.onChange(false);
      } else if (event.key.toLowerCase() === "f" && !event.repeat) {
        if (!current.focused && !current.canFocus) return;
        event.preventDefault();
        current.onChange(!current.focused);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
