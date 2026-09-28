import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { IconButton } from "@/shared/ui/IconButton.jsx";
import { ChevronUpIcon } from "@/shared/ui/icons.jsx";
import styles from "./BackToTop.module.css";

// Shows once the reader is this many screens down the page.
const SHOW_AFTER_SCREENS = 2;

/**
 * Round button in the bottom-right corner that scrolls back to the header.
 * Focus moves to `focusTargetId` (the skip link, the first stop on the page),
 * so a keyboard user carries on from the top too.
 */
export default function BackToTop({ focusTargetId }) {
  const [visible, setVisible] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    function update() {
      setVisible(window.scrollY > window.innerHeight * SHOW_AFTER_SCREENS);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  if (!visible) return null;

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    document.getElementById(focusTargetId)?.focus({ preventScroll: true });
  }

  return (
    <div className={styles.dock}>
      <IconButton variant="secondary" label="Back to top" title="Back to top" className={styles.button} onClick={scrollToTop}>
        <ChevronUpIcon size={18} />
      </IconButton>
    </div>
  );
}
