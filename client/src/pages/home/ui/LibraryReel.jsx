import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStillProjectPath, getStillThumbnail } from "@/entities/still/model/still.js";
import { displayScriptSceneText, getSceneScriptPath } from "@/entities/script-scene/model/capturedScene.js";
import { formatFilmTiming } from "@/entities/script-scene/model/filmTiming.js";
import { sampleStills } from "@/shared/api/stills.js";
import { sampleScriptScenes } from "@/shared/api/scriptScenes.js";
import { cx } from "@/shared/lib/cx.js";
import { preloadImages, whenDrawable } from "@/shared/lib/media/preloadImages.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { formatMomentToHms } from "@/shared/lib/time.js";
import { ScreenplayView } from "@/shared/ui/ScreenplayView.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import styles from "./LibraryReel.module.css";

// Each row repeats its items until it's at least this long, so the loop never shows a gap.
const MIN_ITEMS_PER_ROW = 10;
const SECONDS_PER_ITEM = 5;
const SKELETON_ITEMS = 8;
const PREVIEW_ELEMENTS = 10;
// When to give up on a still and leave it out. This is for an image that has
// stuck rather than one that is merely slow: the placeholder holds the reel's
// shape while the wait runs, and cutting an ordinary slow connection short
// costs the reel a whole row.
const PRELOAD_DEADLINE_MS = 10000;
// How long the built strips wait to be drawable before they're shown anyway.
const DRAW_DEADLINE_MS = 2000;

function settledRows(result) {
  return result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [];
}

/**
 * A random sample of the library's stills and captured scenes, loaded
 * together; null until both requests settle. The reel is extra, so a failed
 * request just leaves its items out.
 */
function useLibrarySample() {
  const [sample, setSample] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([sampleStills(), sampleScriptScenes()]).then(([stills, scenes]) => {
      if (!cancelled) setSample({ stills: settledRows(stills), scenes: settledRows(scenes) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return sample;
}

/**
 * The sampled stills the browser already has the image for; null until they've
 * been waited for. The reel moves on its own, so a frame whose image is still
 * arriving drifts past as a black hole: there is no scroll to start the load
 * off, and nothing to look at while it finishes. Loading first and building the
 * rows from what arrived means every frame that reaches the strip has a picture
 * in it. A still whose thumbnail can't be loaded at all simply stays out.
 */
function useLoadedStills(stills) {
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (!stills) return undefined;
    let cancelled = false;
    const urlFor = (still) => getStillThumbnail(still).url;
    preloadImages(stills.map(urlFor).filter(Boolean), { deadlineMs: PRELOAD_DEADLINE_MS }).then((ready) => {
      if (!cancelled) setLoaded(stills.filter((still) => ready.has(urlFor(still))));
    });
    return () => {
      cancelled = true;
    };
  }, [stills]);

  return loaded;
}

function fillRow(items) {
  if (items.length === 0) return [];
  const row = [...items];
  while (row.length < MIN_ITEMS_PER_ROW) row.push(...items);
  return row;
}

/** A still in the reel. It opens the still on its project page. */
function StillFrame({ still, copy }) {
  const thumbnail = getStillThumbnail(still);
  const url = useSignedMediaUrl(thumbnail.key, thumbnail.url);
  const time = formatMomentToHms(still.time_seconds);
  /*
   * A URL that failed once is not handed to an image again, so a frame waits as
   * a placeholder instead of showing a broken image until the shared cache signs
   * the key afresh. Only a tab left open long enough for a URL to die gets here:
   * every still in the reel was loaded before the strip was built, so its image
   * comes from the browser's cache.
   */
  const [failedUrl, setFailedUrl] = useState(null);
  const shown = url === failedUrl ? null : url;

  return (
    <Link
      className={styles.frame}
      to={getStillProjectPath(still.movie_id, still.id)}
      tabIndex={copy ? -1 : undefined}
      aria-label={`${still.movie_title}, still at ${time}`}
    >
      {/* No lazy loading: it waits on the viewport, which a strip that moves itself never tells it about. */}
      {shown ? (
        <img src={shown} alt="" decoding="async" onError={() => setFailedUrl(shown)} />
      ) : (
        <Skeleton className={styles.frameWaiting} />
      )}
      <span className={styles.caption}>
        <span className={styles.captionTitle}>{still.movie_title}</span>
        <span className={styles.captionTime}>{time}</span>
      </span>
    </Link>
  );
}

/** A captured scene in the reel: the top of its screenplay text. It opens the scene in its script. */
function SceneFrame({ scene, copy }) {
  const timing = formatFilmTiming(scene);

  return (
    <Link
      className={cx(styles.frame, styles.sceneFrame)}
      to={getSceneScriptPath(scene)}
      tabIndex={copy ? -1 : undefined}
      aria-label={`${scene.movie_title}, scene at ${timing}`}
    >
      <div className={styles.paper}>
        <ScreenplayView source={displayScriptSceneText(scene)} variant="card" maxElements={PREVIEW_ELEMENTS} />
      </div>
      <span className={styles.caption}>
        <span className={styles.captionTitle}>{scene.movie_title}</span>
        <span className={styles.captionTime}>{timing}</span>
      </span>
    </Link>
  );
}

function ReelRow({ items, reverse, renderItem }) {
  const row = fillRow(items);

  return (
    <div
      className={cx(styles.track, reverse && styles.trackReverse)}
      style={{ "--reel-duration": `${row.length * SECONDS_PER_ITEM}s` }}
    >
      <div className={styles.strip}>
        <ul className={styles.list}>
          {row.map((item, index) => (
            <li key={`${item.id}-${index}`}>{renderItem(item, false)}</li>
          ))}
        </ul>
        {/* The loop's second copy: still clickable, but skipped by screen readers and the Tab key. */}
        <ul className={cx(styles.list, styles.copy)} aria-hidden="true">
          {row.map((item, index) => (
            <li key={`${item.id}-${index}`}>{renderItem(item, true)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* One placeholder row per strip, each the shape of the strip it stands in for,
 * so the reel arriving doesn't push the rest of the page down. */
function ReelSkeleton() {
  return (
    <div className={styles.reel} aria-hidden="true">
      {[styles.skeletonFrame, styles.skeletonFrameNarrow, styles.skeletonScene].map((frame, row) => (
        <div className={styles.track} key={row}>
          <div className={styles.list}>
            {Array.from({ length: SKELETON_ITEMS }, (_, index) => (
              <Skeleton key={index} className={frame} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Whether the strips in `node` are ready to be looked at: their images are
 * already cached by the time they're built, but each of the dozens of frames
 * still has to be given a bitmap of its own, and that work lands on the frames
 * right after they appear. Waiting a beat for it, then fading in, is what keeps
 * the reel from being watched filling in. It gives up at the deadline, so the
 * strips are never held back by an image that won't settle.
 */
function useDrawnStrips(node) {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (!node) return undefined;
    let cancelled = false;
    let frame = null;
    whenDrawable([...node.querySelectorAll("img")], { deadlineMs: DRAW_DEADLINE_MS }).then(() => {
      // On the frame after, so the reveal starts once the drawing has been done
      // rather than alongside it.
      if (!cancelled) frame = requestAnimationFrame(() => setDrawn(true));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [node]);

  return drawn;
}

function ReelStrips({ stills, scenes }) {
  const half = Math.ceil(stills.length / 2);
  const stillRows = stills.length >= MIN_ITEMS_PER_ROW ? [stills.slice(0, half), stills.slice(half)] : [stills];
  const renderStill = (still, copy) => <StillFrame still={still} copy={copy} />;
  const [node, setNode] = useState(null);
  const drawn = useDrawnStrips(node);

  return (
    <div ref={setNode} className={cx(styles.reel, styles.strips, drawn && styles.stripsDrawn)}>
      {stillRows.map(
        (row, index) => row.length > 0 && <ReelRow key={index} items={row} reverse={index === 1} renderItem={renderStill} />
      )}
      {scenes.length > 0 && (
        <ReelRow items={scenes} renderItem={(scene, copy) => <SceneFrame scene={scene} copy={copy} />} />
      )}
    </div>
  );
}

/**
 * The home page's "From the library" section. It loads its own random sample
 * of the library and draws strips drifting across the page: two of film stills
 * in opposite directions, then one of captured scenes' screenplay text. Each
 * strip is drawn twice so it loops seamlessly. Hovering or focusing a strip
 * pauses it; with reduced motion the strips sit still and scroll sideways
 * instead.
 *
 * The strips are built only once their stills have loaded, so the reel arrives
 * whole rather than filling in as it drifts; a placeholder in the shape of the
 * strips holds the space until then. When the library has nothing to show, the
 * sample can't load, or none of its stills will load, the section leaves the
 * page.
 */
export function LibraryReel() {
  const sample = useLibrarySample();
  const stills = useLoadedStills(sample?.stills);
  const scenes = sample?.scenes ?? null;
  const ready = stills !== null && scenes !== null;
  if (ready && stills.length === 0 && scenes.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="home-library-heading" aria-busy={!ready}>
      <div className={styles.heading}>
        <SectionHeading id="home-library-heading" title="From the library" />
      </div>
      {ready ? <ReelStrips stills={stills} scenes={scenes} /> : <ReelSkeleton />}
    </section>
  );
}
