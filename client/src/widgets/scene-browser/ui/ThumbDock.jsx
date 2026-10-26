import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SceneTextStyleToggle } from "@/features/scene-text-style/ui/SceneTextStyleToggle.jsx";
import { cx } from "@/shared/lib/cx.js";
import { isTypingTarget } from "@/shared/lib/keyboard.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { Button } from "@/shared/ui/Button.jsx";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { ChevronUpIcon } from "@/shared/ui/icons.jsx";
import styles from "./ThumbDock.module.css";

// Scrolling less than this either way leaves the dock where it is.
const MIN_SCROLL_DELTA = 6;
// Near the top of the page the dock always shows.
const SHOW_NEAR_TOP = 80;
// A scroll this soon after a touch, the wheel or a scrolling key is the reader's own.
const READER_SCROLL_MS = 400;
const SCROLL_KEYS = new Set([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "End", "Home"]);
// The scene browser has the dock once its top is within this of where it pins (--browser-top).
const ARRIVAL_SLACK = 12;

/**
 * Follows the window's scroll: whether the scene browser has come up to where
 * it pins (`arrived`), whether the dock steps aside for a reader scrolling
 * down (`away`), and whether the reader is a screen or more down the page
 * (`down`). Only the reader's own scrolling moves the dock: not a jump a tool
 * made, nor the window keeping its place as cards change size beneath it.
 */
function useDockScroll(browserRef) {
  const [arrived, setArrived] = useState(true);
  const [away, setAway] = useState(false);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let lastInput = -Infinity;
    let frame = 0;

    function update() {
      frame = 0;
      const y = window.scrollY;
      setDown(y > window.innerHeight);
      const browser = browserRef.current;
      if (browser) {
        const pinTop = parseFloat(window.getComputedStyle(browser).getPropertyValue("--browser-top")) || 0;
        setArrived(browser.getBoundingClientRect().top <= pinTop + ARRIVAL_SLACK);
      }
      if (y <= SHOW_NEAR_TOP) {
        setAway(false);
      } else if (Math.abs(y - lastY) >= MIN_SCROLL_DELTA) {
        if (y < lastY) setAway(false);
        else if (performance.now() - lastInput < READER_SCROLL_MS) setAway(true);
      } else {
        return;
      }
      lastY = y;
    }

    function queueUpdate() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    function noteInput() {
      lastInput = performance.now();
    }

    function noteKey(event) {
      if (SCROLL_KEYS.has(event.key) && !isTypingTarget(event.target)) noteInput();
    }

    update();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);
    window.addEventListener("touchmove", noteInput, { passive: true });
    window.addEventListener("wheel", noteInput, { passive: true });
    window.addEventListener("keydown", noteKey);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
      window.removeEventListener("touchmove", noteInput);
      window.removeEventListener("wheel", noteInput);
      window.removeEventListener("keydown", noteKey);
    };
  }, [browserRef]);

  return { arrived, away, down };
}

/**
 * How far the on-screen keyboard covers the bottom of the window while a field
 * in the dock is being typed in, so the dock can ride above it.
 */
function useKeyboardLift(dockRef) {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    const dock = dockRef.current;
    const viewport = window.visualViewport;
    if (!dock || !viewport) return undefined;
    let frame = 0;

    function update() {
      frame = 0;
      const active = document.activeElement;
      const typing = dock.contains(active) && isTypingTarget(active);
      setLift(typing ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0);
    }

    // Focus moving out of the dock lands after focusout, so the check waits a frame.
    function queueUpdate() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    viewport.addEventListener("resize", queueUpdate);
    viewport.addEventListener("scroll", queueUpdate);
    dock.addEventListener("focusin", queueUpdate);
    dock.addEventListener("focusout", queueUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", queueUpdate);
      viewport.removeEventListener("scroll", queueUpdate);
      dock.removeEventListener("focusin", queueUpdate);
      dock.removeEventListener("focusout", queueUpdate);
    };
  }, [dockRef]);

  return lift;
}

/** A round, clear tile on the dock's glass. */
export function DockTile({ className, ...props }) {
  return <IconButton className={cx(styles.tile, className)} {...props} />;
}

/** A worded button on the dock's glass, such as Scenes and its count. */
export function DockButton({ className, ...props }) {
  return <Button variant="ghost" className={cx(styles.button, className)} {...props} />;
}

/** The page style's toggle, as a round, clear tile. */
export function DockPageStyle() {
  return <SceneTextStyleToggle look="toolbar" className={styles.pageStyle} />;
}

/** A hairline between groups of tools. */
export function DockRule() {
  return <span className={styles.rule} aria-hidden="true" />;
}

/**
 * The scene browser's tools on a phone (SceneBrowser renders it at its drawer
 * width): a glass pill at the bottom of the screen, in a thumb's reach,
 * instead of a crowded row at the top. It's drawn at the end of the document,
 * clear of anything the page does to the browser around it. It steps aside
 * while the reader scrolls down, comes back on the way up, and rides above the
 * keyboard while its search is typed in.
 *
 * lead: the way back up, before the tools, such as the script viewer's way
 *   back to its script. Without one, the way to the top of the page, which
 *   unfolds once the reader is a screen down.
 * elsewhere: { label, tools } the dock holds instead until the browser comes
 *   up to where it pins, as the script viewer's own tools over its script.
 * hidden: the dock leaves altogether, as in focused reading.
 */
export function ThumbDock({ browserRef, label = "Scene tools", lead, elsewhere, hidden = false, children }) {
  const dockRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const { arrived, away, down } = useDockScroll(browserRef);
  const lift = useKeyboardLift(dockRef);
  // The way to the top keeps its place while it has focus, as on the way there.
  const [leadFocused, setLeadFocused] = useState(false);
  const showElsewhere = Boolean(elsewhere) && !arrived;
  const leadShown = Boolean(lead) || down || leadFocused;

  // The page's own back-to-top button would sit under the dock (BackToTop.module.css).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.thumbDock = "";
    return () => {
      delete root.dataset.thumbDock;
    };
  }, []);

  return createPortal(
    <div
      ref={dockRef}
      className={cx(styles.dock, (hidden || (away && lift === 0)) && styles.away)}
      style={lift ? { "--dock-lift": `${lift}px` } : undefined}
      role="toolbar"
      aria-label={showElsewhere ? elsewhere.label : label}
      inert={hidden}
    >
      {elsewhere && (
        <div className={styles.group} hidden={!showElsewhere}>
          {elsewhere.tools}
        </div>
      )}
      <div className={styles.group} hidden={showElsewhere}>
        <span
          className={cx(styles.lead, !leadShown && styles.leadAway)}
          inert={!leadShown}
          onFocus={() => setLeadFocused(true)}
          onBlur={() => setLeadFocused(false)}
        >
          {lead ?? (
            <DockTile
              label="Back to top"
              title="Back to top"
              onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" })}
            >
              <ChevronUpIcon size={18} />
            </DockTile>
          )}
          <DockRule />
        </span>
        {children}
      </div>
    </div>,
    document.body
  );
}
