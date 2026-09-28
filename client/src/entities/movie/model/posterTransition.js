import { navigateWithTransition } from "@/shared/lib/viewTransition.js";

/**
 * Opening a project from its card, the card's poster glides into place as the
 * poster on the project page. Both posters carry this view-transition name:
 * the card's only for the click that opens it, the project page's always.
 */
const POSTER_TRANSITION_NAME = "project-poster";

const PROJECT_POSTER_SELECTOR = "img[data-project-poster]";

/**
 * History state for opening a project from its card: the project page shows
 * this cover while it loads, so the transition needn't wait for the network.
 */
export function posterTransitionState(coverUrl, coverKey) {
  return { posterUrl: coverUrl, posterKey: coverKey };
}

/** The cover a card handed over in history state, if any. */
export function getHandedOverPosterUrl(locationState) {
  return typeof locationState?.posterUrl === "string" ? locationState.posterUrl : "";
}

/** Props for the project page's poster, the transition's destination. */
export const projectPosterProps = {
  "data-project-poster": "",
  style: { viewTransitionName: POSTER_TRANSITION_NAME },
};

/** Whether the project page's poster is on screen and loaded. */
function isProjectPosterReady() {
  const poster = document.querySelector(PROJECT_POSTER_SELECTOR);
  return Boolean(poster?.complete && poster.naturalWidth > 0);
}

// A document can snapshot only one source with this name at a time.
let posterTransitionActive = false;

/** Owns the source name until capture, including fast clicks on another card. */
export function openProjectWithPosterTransition(navigate, to, image, state) {
  if (posterTransitionActive) return;
  posterTransitionActive = true;
  image.style.viewTransitionName = POSTER_TRANSITION_NAME;
  const clearName = () => { image.style.viewTransitionName = ""; };
  try {
    const transition = navigateWithTransition(navigate, to, {
      state, isReady: isProjectPosterReady, onCaptured: clearName,
    });
    transition.finished.catch(() => {}).finally(() => {
      clearName();
      posterTransitionActive = false;
    });
  } catch {
    clearName();
    posterTransitionActive = false;
    navigate(to, { state });
  }
}
