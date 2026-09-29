/*
 * Loading images ahead of the frames that show them.
 *
 * An `<img>` draws nothing until its bytes arrive and have been decoded, so
 * anything that puts a picture on screen without being asked to — a reel that
 * drifts on its own, a slideshow that advances on a timer — shows a hole for as
 * long as that takes. There is no scrolling to blame it on and nothing for the
 * reader to do about it. Waiting first, and only then building what shows the
 * images, trades a wait nobody sees for a gap everybody does.
 *
 * Both waits here are bounded. An image that hasn't arrived by the deadline is
 * given up on rather than holding back everything else, because a reel that is
 * late is worse than a reel that is short.
 */

/** Settles with whatever `work` gave, or gives up once `deadlineMs` has passed. */
function withDeadline(work, deadlineMs) {
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** Resolves true once the browser can draw this URL's image, false if it can't get it. */
function preloadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    /*
     * Loading settles whether the image is usable; decoding is then waited on
     * only to have its bitmap ready. The answer doesn't turn on it, so a browser
     * that won't decode a detached image leaves a still in the reel rather than
     * dropping it.
     */
    image.onload = () => {
      if (!image.decode) return resolve(true);
      image.decode().then(() => resolve(true), () => resolve(true));
    };
    image.onerror = () => resolve(false);
    image.decoding = "async";
    image.src = url;
  });
}

/**
 * Loads these URLs and answers with the ones the browser got, as a set. A URL
 * still in flight at the deadline is left out; its request is not cancelled, so
 * it still warms the cache for later.
 */
export function preloadImages(urls, { deadlineMs }) {
  const loaded = new Set();
  const all = Promise.all(
    urls.map((url) =>
      preloadImage(url).then((ok) => {
        if (ok) loaded.add(url);
      })
    )
  );

  // A copy, because the requests still in flight go on filling the set: the
  // answer is what had arrived by the time it was asked for, not a view that
  // changes underneath whoever is holding it.
  return withDeadline(all, deadlineMs).then(() => new Set(loaded));
}

/**
 * Resolves once these `<img>` elements have their bitmaps, or at the deadline.
 *
 * Their bytes being cached is not the same as their being ready to draw: an
 * element that has just been created still has to be given a bitmap of its own,
 * and a page that puts dozens on screen at once does all of that work on the
 * frames right after they appear. Waiting for it is what keeps a picture from
 * being watched arriving.
 */
export function whenDrawable(images, { deadlineMs }) {
  const drawn = images.map((image) => (image.decode ? image.decode().catch(() => {}) : Promise.resolve()));
  return withDeadline(Promise.all(drawn), deadlineMs);
}
