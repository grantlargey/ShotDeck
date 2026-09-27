import { useEffect, useState } from "react";
import { MOVIE_CREDITS } from "@/entities/movie/model/movieCredits.js";
import { cx } from "@/shared/lib/cx.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { formatMinutesToHms, formatMomentToHms } from "@/shared/lib/time.js";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import styles from "./MovieDetailPage.module.css";

const NO_STILLS = [];
// How many of the film's stills take turns behind the hero.
const BACKDROP_STILL_COUNT = 6;
// How long each backdrop still holds before the next one fades in. The caption's countdown runs this long too.
const BACKDROP_HOLD_MS = 7000;
const NO_TURNS = { source: null, ids: [], currentId: null, shownIds: new Set() };

/** Up to `count` ids of stills with a viewable image, in random order. */
function pickBackdropIds(stills, count) {
  const ids = stills.filter((row) => row.image_url).map((row) => row.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

/**
 * The turn order for a new stills list. The first list picks it at random. A
 * reload keeps it, less any stills that were deleted, and keeps the still on
 * screen, or moves to the next one when that still was deleted. The order is
 * picked anew only when none of its stills are left.
 */
function retakeTurns(turns, stills) {
  const viewable = new Set(stills.filter((row) => row.image_url).map((row) => row.id));
  const kept = turns.ids.filter((stillId) => viewable.has(stillId));
  if (kept.length === 0) {
    const ids = pickBackdropIds(stills, BACKDROP_STILL_COUNT);
    return { source: stills, ids, currentId: ids[0] ?? null, shownIds: new Set(ids.slice(0, 1)) };
  }
  const from = turns.ids.indexOf(turns.currentId);
  const currentId = [...turns.ids.slice(from), ...turns.ids.slice(0, from)].find((stillId) => viewable.has(stillId));
  return { source: stills, ids: kept, currentId, shownIds: new Set(turns.shownIds).add(currentId) };
}

function nextTurnId(turns) {
  return turns.ids[(turns.ids.indexOf(turns.currentId) + 1) % turns.ids.length];
}

function advanceTurn(turns) {
  const currentId = nextTurnId(turns);
  return { ...turns, currentId, shownIds: new Set(turns.shownIds).add(currentId) };
}

/**
 * Which of the film's stills take turns behind the hero, and which one is on
 * screen. Turns are tracked by still id, so a reload that deletes a still
 * elsewhere in the order leaves the one on screen alone. A still stays mounted
 * once shown, and the next one mounts early, so each has loaded by the time it
 * fades in. With reduced motion the first still simply stays.
 */
function useBackdropTurns(stills) {
  const reducedMotion = usePrefersReducedMotion();
  const [turns, setTurns] = useState(NO_TURNS);
  if (turns.source !== stills) setTurns(retakeTurns(turns, stills));
  const cycling = turns.ids.length > 1 && !reducedMotion;

  useEffect(() => {
    if (!cycling) return undefined;
    const timer = window.setTimeout(() => setTurns(advanceTurn), BACKDROP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [cycling, turns.currentId]);

  const byId = new Map(stills.map((row) => [row.id, row]));
  const nextId = cycling ? nextTurnId(turns) : null;
  return {
    current: byId.get(turns.currentId) ?? null,
    mounted: turns.ids
      .filter((stillId) => turns.shownIds.has(stillId) || stillId === nextId)
      .map((stillId) => byId.get(stillId))
      .filter(Boolean),
    cycling,
  };
}

/**
 * The hero's backdrop stills: each slowly pushes in and then dissolves into
 * the next. The caption names the still on screen and opens it.
 */
function BackdropStills({ current, mounted, cycling, onOpenStill }) {
  const [loadedIds, setLoadedIds] = useState(() => new Set());
  const time = formatMomentToHms(current.time_seconds);

  return (
    <>
      {mounted.map((still) => (
        <img
          key={still.id}
          className={cx(
            styles.backdrop,
            styles.backdropStill,
            still.id === current.id && loadedIds.has(still.id) && styles.backdropLoaded
          )}
          src={still.image_url}
          alt=""
          onLoad={() => setLoadedIds((value) => new Set(value).add(still.id))}
        />
      ))}

      <button
        type="button"
        className={styles.backdropCaption}
        onClick={() => onOpenStill?.(current.id)}
        aria-label={`Open the still at ${time}`}
      >
        <span className={styles.backdropLabel}>Still</span>
        <span className={styles.backdropTime}>{time}</span>
        {cycling && (
          <span
            className={styles.backdropProgress}
            style={{ "--backdrop-hold": `${BACKDROP_HOLD_MS}ms` }}
            aria-hidden="true"
          >
            <span key={current.id} />
          </span>
        )}
      </button>
    </>
  );
}

/**
 * Full-width project hero. A few of the film's stills, picked at random, take
 * turns as the backdrop; without any, a blurred copy of the cover stands in.
 * Only credits that are filled in show.
 */
export function MovieHeader({ movie, coverUrl, stills = NO_STILLS, onOpenStill, actions }) {
  const backdrop = useBackdropTurns(stills);
  const facts = [
    { label: "Year", value: movie.year },
    { label: "Runtime", value: movie.runtime_minutes ? formatMinutesToHms(movie.runtime_minutes) : "" },
    ...MOVIE_CREDITS.map(({ field, label }) => ({ label, value: movie[field] })),
  ].filter((fact) => fact.value);
  // The stills load after the header, so the cover fades in rather than popping when stills replace it.
  const [coverLoaded, setCoverLoaded] = useState(false);

  return (
    <section className={styles.hero}>
      {backdrop.current ? (
        <BackdropStills {...backdrop} onOpenStill={onOpenStill} />
      ) : (
        coverUrl && (
          <img
            className={cx(styles.backdrop, styles.backdropBlurred, coverLoaded && styles.backdropLoaded)}
            src={coverUrl}
            alt=""
            onLoad={() => setCoverLoaded(true)}
          />
        )
      )}

      <div className={styles.heroInner}>
        {coverUrl ? (
          <img className={styles.poster} src={coverUrl} alt={`${movie.title} cover`} />
        ) : (
          <div className={styles.poster} aria-hidden="true" />
        )}

        <div className={styles.heroBody}>
          <p className={styles.eyebrow}>Project</p>
          <h1 className={styles.heroTitle}>{movie.title}</h1>
          {facts.length > 0 && (
            <dl className={styles.facts}>
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {actions && <div className={styles.heroActions}>{actions}</div>}
        </div>
      </div>
    </section>
  );
}

/** Placeholder with the hero's shape, shown while the project loads. */
export function MovieHeaderSkeleton() {
  return (
    <section className={styles.hero} aria-hidden="true">
      <div className={styles.heroInner}>
        <Skeleton className={styles.poster} />
        <div className={styles.heroBody}>
          <Skeleton className={styles.skeletonEyebrow} />
          <Skeleton className={styles.skeletonTitle} />
          <Skeleton className={styles.skeletonFacts} />
        </div>
      </div>
    </section>
  );
}
