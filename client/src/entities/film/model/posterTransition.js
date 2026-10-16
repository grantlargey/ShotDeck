import { navigateWithTransition } from "@/shared/lib/viewTransition.js";

/**
 * Opening a film from its card, the card's poster glides into place as the
 * poster on the film page. Both posters carry this view-transition name:
 * the card's only for the click that opens it, the film page's always.
 */
const POSTER_TRANSITION_NAME = "film-poster";

const FILM_POSTER_SELECTOR = "img[data-film-poster]";

/**
 * History state for opening a film from its card: the film page shows
 * this cover while it loads, so the transition needn't wait for the network.
 */
export function posterTransitionState(coverUrl, coverKey) {
  return { posterUrl: coverUrl, posterKey: coverKey };
}

/** The cover a card handed over in history state, if any. */
export function getHandedOverPosterUrl(locationState) {
  return typeof locationState?.posterUrl === "string" ? locationState.posterUrl : "";
}

/** Props for the film page's poster, the transition's destination. */
export const filmPosterProps = {
  "data-film-poster": "",
  style: { viewTransitionName: POSTER_TRANSITION_NAME },
};

/** Whether the film page's poster is on screen and loaded. */
function isFilmPosterReady() {
  const poster = document.querySelector(FILM_POSTER_SELECTOR);
  return Boolean(poster?.complete && poster.naturalWidth > 0);
}

// A document can snapshot only one source with this name at a time.
let posterTransitionActive = false;

/** Owns the source name until capture, including fast clicks on another card. */
export function openFilmWithPosterTransition(navigate, to, image, state) {
  if (posterTransitionActive) return;
  posterTransitionActive = true;
  image.style.viewTransitionName = POSTER_TRANSITION_NAME;
  const clearName = () => { image.style.viewTransitionName = ""; };
  try {
    const transition = navigateWithTransition(navigate, to, {
      state, isReady: isFilmPosterReady, onCaptured: clearName,
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
