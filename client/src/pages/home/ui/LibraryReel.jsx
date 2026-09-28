import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStillProjectPath, getStillThumbnail } from "@/entities/still/model/still.js";
import { displayScriptSceneText, getSceneScriptPath } from "@/entities/script-scene/model/capturedScene.js";
import { formatFilmTiming } from "@/entities/script-scene/model/filmTiming.js";
import { sampleStills } from "@/shared/api/stills.js";
import { sampleScriptScenes } from "@/shared/api/scriptScenes.js";
import { cx } from "@/shared/lib/cx.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { formatMomentToHms } from "@/shared/lib/time.js";
import { ScreenplayView } from "@/shared/ui/ScreenplayView.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import styles from "./LibraryReel.module.css";

// Each row repeats its items until it's at least this long, so the loop never shows a gap.
const MIN_ITEMS_PER_ROW = 10;
const SECONDS_PER_ITEM = 5;
const SKELETON_ITEMS = 6;
const PREVIEW_ELEMENTS = 10;

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

  return (
    <Link
      className={styles.frame}
      to={getStillProjectPath(still.movie_id, still.id)}
      tabIndex={copy ? -1 : undefined}
      aria-label={`${still.movie_title}, still at ${time}`}
    >
      {url && <img src={url} alt="" loading="lazy" decoding="async" />}
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

function ReelSkeleton() {
  return (
    <div className={styles.reel} aria-hidden="true">
      <div className={styles.track}>
        <div className={styles.list}>
          {Array.from({ length: SKELETON_ITEMS }, (_, index) => (
            <Skeleton key={index} className={styles.skeletonFrame} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReelStrips({ stills, scenes }) {
  const half = Math.ceil(stills.length / 2);
  const stillRows = stills.length >= MIN_ITEMS_PER_ROW ? [stills.slice(0, half), stills.slice(half)] : [stills];
  const renderStill = (still, copy) => <StillFrame still={still} copy={copy} />;

  return (
    <div className={styles.reel}>
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
 * instead. When the library has nothing to show, or the sample can't load, the
 * section leaves the page.
 */
export function LibraryReel() {
  const sample = useLibrarySample();
  if (sample && sample.stills.length === 0 && sample.scenes.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="home-library-heading" aria-busy={!sample}>
      <div className={styles.heading}>
        <SectionHeading id="home-library-heading" title="From the library" />
      </div>
      {sample ? <ReelStrips stills={sample.stills} scenes={sample.scenes} /> : <ReelSkeleton />}
    </section>
  );
}
