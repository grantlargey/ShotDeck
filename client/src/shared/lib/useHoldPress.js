import { useEffect, useRef, useState } from "react";

// A touch held this long (ms) is a hold, not a tap. Card styles trace their hold ring over the same time.
export const HOLD_MS = 500;
// A finger that drifts further than this (px) is scrolling the page, not pressing.
const DRIFT_PX = 10;

/**
 * Tap or hold on a touch screen. A touch tap runs `onTap` and a touch held for
 * HOLD_MS runs `onHold`, whose trailing click is swallowed; mouse clicks still
 * run `onClick`. Without `onHold` every click runs `onClick`. `holding` is true
 * while a touch could still become a hold, so the element can show it filling.
 * Spread `pressProps` onto the element in place of its onClick.
 */
export function useHoldPress({ onClick, onTap, onHold }) {
  const [holding, setHolding] = useState(false);
  const press = useRef(null);
  const touched = useRef(false);
  const held = useRef(false);

  function release() {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
    setHolding(false);
  }

  useEffect(() => () => window.clearTimeout(press.current?.timer), []);

  if (!onHold) return { holding: false, pressProps: { onClick } };

  return {
    holding,
    pressProps: {
      onPointerDown(event) {
        touched.current = event.pointerType !== "mouse";
        held.current = false;
        if (!touched.current || !event.isPrimary) return;
        release();
        const timer = window.setTimeout(() => {
          press.current = null;
          held.current = true;
          setHolding(false);
          navigator.vibrate?.(12);
          onHold();
        }, HOLD_MS);
        press.current = { x: event.clientX, y: event.clientY, timer };
        setHolding(true);
      },
      onPointerMove(event) {
        const start = press.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRIFT_PX) release();
      },
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
      // A long touch would otherwise raise the browser's own menu.
      onContextMenu(event) {
        if (touched.current) event.preventDefault();
      },
      onClick(event) {
        if (held.current) {
          held.current = false;
          return;
        }
        (touched.current && onTap ? onTap : onClick)?.(event);
      },
    },
  };
}
