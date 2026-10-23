import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  findNearestStillIndex,
  getTimelineBins,
  getTimelinePositionPercent,
  getTimelineScale,
} from "@/entities/still/model/stillTimeline.js";
import { getStillThumbnail } from "@/entities/still/model/still.js";
import { cx } from "@/shared/lib/cx.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { formatMomentToHms, formatSecondsToHms } from "@/shared/lib/time.js";
import styles from "./StillTimeline.module.css";

// One density bar per this many pixels of strip width.
const PX_PER_BAR = 6;
const MIN_BARS = 24;
const BAR_MIN_HEIGHT = 5;
const BAR_MAX_HEIGHT = 24;

// The hero's mark steps along the bars to each new still over the 1.8s the
// backdrop takes to dissolve (FilmDetailPage.module.css), a bar at a time.
const HERO_STEP_MS = 1800;
// Starting over at an earlier still, it fades out and back in instead.
const HERO_FADE_MS = 350;
// A release this close to the mark opens the hero's own still.
const HERO_HIT_PX = 3;

const KEY_STEPS = new Map([
  ["ArrowRight", 1],
  ["ArrowUp", 1],
  ["ArrowLeft", -1],
  ["ArrowDown", -1],
  ["PageUp", 10],
  ["PageDown", -10],
]);

const clampIndex = (index, count) => Math.min(count - 1, Math.max(0, index));

/**
 * The stills counted into one bar per PX_PER_BAR pixels of the strip's width
 * (at least MIN_BARS), counted again whenever the strip resizes. Empty until
 * the strip has been measured.
 */
function useStripBins(stripRef, stills, runtimeSeconds) {
  const [binCount, setBinCount] = useState(0);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const observer = new ResizeObserver(() => {
      setBinCount(Math.max(MIN_BARS, Math.floor(strip.clientWidth / PX_PER_BAR)));
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stripRef]);

  return useMemo(
    () => (binCount ? getTimelineBins(stills, runtimeSeconds, binCount) : []),
    [stills, runtimeSeconds, binCount]
  );
}

/**
 * The bar the hero's mark stands on, given the bar of the hero's still
 * (`target`, -1 for none) out of `binCount`. When the hero moves on to a
 * later still, the mark steps there one bar at a time; when it starts over at
 * an earlier one, the mark fades out and comes back on that bar. It jumps when
 * the strip is measured anew or the visitor asks for less motion. `fading` is
 * true while it is out.
 */
function useHeroMark(target, binCount) {
  const reducedMotion = usePrefersReducedMotion();
  const [mark, setMark] = useState({ bin: target, target, binCount, fading: false, stepMs: 0 });

  if (mark.target !== target || mark.binCount !== binCount) {
    const jump = mark.binCount !== binCount || mark.bin < 0 || target < 0 || reducedMotion;
    setMark(
      jump
        ? { bin: target, target, binCount, fading: false, stepMs: 0 }
        : {
            bin: mark.bin,
            target,
            binCount,
            fading: target < mark.bin,
            stepMs: target > mark.bin ? HERO_STEP_MS / (target - mark.bin) : 0,
          }
    );
  }

  useEffect(() => {
    if (mark.bin === mark.target) return undefined;
    const timer = mark.fading
      ? window.setTimeout(() => setMark((current) => ({ ...current, bin: current.target, fading: false })), HERO_FADE_MS)
      : window.setTimeout(
          () => setMark((current) => ({ ...current, bin: Math.min(current.target, current.bin + 1) })),
          Math.max(16, mark.stepMs)
        );
    return () => window.clearTimeout(timer);
  }, [mark]);

  return mark;
}

/**
 * One bar per slice of the runtime. Drawn three times (resting, lit, and in
 * the hero's mark), so memoized.
 */
const DensityBars = memo(function DensityBars({ bins, className }) {
  const max = Math.max(1, ...bins);

  return (
    <span className={className} aria-hidden="true">
      {bins.map((count, i) => (
        <span
          key={i}
          className={cx(styles.bar, count === 0 && styles.barEmpty)}
          style={{
            left: `${((i + 0.5) / bins.length) * 100}%`,
            height: count
              ? BAR_MIN_HEIGHT + Math.round((BAR_MAX_HEIGHT - BAR_MIN_HEIGHT) * Math.sqrt(count / max))
              : undefined,
          }}
        />
      ))}
    </span>
  );
});

function StillPreview({ still, index, percent, total }) {
  const thumbnail = getStillThumbnail(still);
  const url = useSignedMediaUrl(thumbnail.key, thumbnail.url);

  return (
    <div className={styles.preview} style={{ "--pos": `${percent}%` }} aria-hidden="true">
      <div className={styles.previewFrame}>{url && <img src={url} alt="" />}</div>
      <div className={styles.previewMeta}>
        <span className={styles.previewTime}>{formatMomentToHms(still.time_seconds)}</span>
        <span className={styles.previewIndex}>
          {index + 1} of {total}
        </span>
      </div>
    </div>
  );
}

/**
 * The film's runtime as a strip of density bars. Hovering, dragging or the
 * arrow keys preview the nearest still; clicking or Enter opens it.
 * `highlightedIndex` (the grid still under the pointer) lights up the bars
 * around that still.
 *
 * `heroIndex` is the still behind the film hero: the bar nearest it turns
 * blue, and steps along the bars to the next still when the hero moves on.
 * `showHero` false fades the mark out, for when the hero is out of sight.
 * `pendingSeconds` marks where a still being added would go.
 */
export function StillTimeline({
  stills,
  highlightedIndex = -1,
  heroIndex = -1,
  showHero = true,
  pendingSeconds = null,
  onSelect,
  runtimeSeconds,
  selectedIndex = -1,
}) {
  const stripRef = useRef(null);
  const draggingRef = useRef(false);
  // The index survives hiding the preview so keyboard navigation can pick up there.
  // A null previewPercent hides the preview; otherwise it centres the lit band.
  const [cursor, setCursor] = useState({ index: 0, previewPercent: null });

  const bins = useStripBins(stripRef, stills, runtimeSeconds);
  const scale = useMemo(() => getTimelineScale(runtimeSeconds), [runtimeSeconds]);

  const count = stills.length;
  const percentOf = (index) => getTimelinePositionPercent(stills[index], runtimeSeconds);
  const previewActive = cursor.previewPercent !== null;
  const valueIndex = clampIndex(cursor.index, count);

  // The same slices getTimelineBins counts the hero's still into.
  const heroBin =
    heroIndex >= 0 && heroIndex < count && bins.length
      ? Math.min(bins.length - 1, Math.floor((percentOf(heroIndex) / 100) * bins.length))
      : -1;
  const heroMark = useHeroMark(heroBin, bins.length);
  const heroPercent = heroMark.bin >= 0 ? ((heroMark.bin + 0.5) / bins.length) * 100 : null;

  function showStill(index, percent) {
    const next = clampIndex(index, count);
    if (next < 0) return;
    setCursor({ index: next, previewPercent: percent ?? percentOf(next) });
  }

  function hidePreview() {
    setCursor((current) => {
      if (current.previewPercent === null) return current;
      return { ...current, previewPercent: null };
    });
  }

  function pointerPercent(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
  }

  /** The hero's still when a release lands on its mark, or the still nearest the release. */
  function releasedIndex(event) {
    const percent = pointerPercent(event);
    const width = event.currentTarget.getBoundingClientRect().width;
    const onHero =
      heroPercent !== null && showHero && heroIndex < count && (Math.abs(percent - heroPercent) / 100) * width <= HERO_HIT_PX;
    return onHero ? heroIndex : findNearestStillIndex(stills, runtimeSeconds, percent);
  }

  function previewAtPointer(event) {
    const percent = pointerPercent(event);
    showStill(findNearestStillIndex(stills, runtimeSeconds, percent), percent);
  }

  function handlePointerDown(event) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewAtPointer(event);
  }

  function handlePointerMove(event) {
    if (event.pointerType === "mouse" || draggingRef.current) previewAtPointer(event);
  }

  // A completed gesture opens the still at release; only the mouse keeps its preview.
  function handlePointerUp(event) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const index = releasedIndex(event);
    if (event.pointerType !== "mouse") hidePreview();
    if (index >= 0) onSelect(index);
  }

  function handlePointerCancel() {
    draggingRef.current = false;
    hidePreview();
  }

  function handlePointerLeave() {
    if (!draggingRef.current) hidePreview();
  }

  function handleKeyDown(event) {
    const from = previewActive ? cursor.index : valueIndex;
    let index;
    if (KEY_STEPS.has(event.key)) index = from + KEY_STEPS.get(event.key);
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = count - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (from >= 0) onSelect(from);
      return;
    } else return;

    event.preventDefault();
    showStill(index);
  }

  function handleFocus(event) {
    if (event.currentTarget.matches(":focus-visible")) showStill(cursor.index);
  }

  const previewStill = previewActive ? stills[cursor.index] : null;
  let liveSpot = null;
  if (previewActive) liveSpot = cursor.previewPercent;
  else if (highlightedIndex >= 0) liveSpot = percentOf(highlightedIndex);
  // The lit band fades out where it last was, rather than sliding to the start as it goes.
  const [restingSpot, setRestingSpot] = useState(null);
  if (liveSpot !== null && liveSpot !== restingSpot) setRestingSpot(liveSpot);
  const spot = liveSpot ?? restingSpot;

  const style = {};
  if (spot !== null) style["--spot"] = `${spot}%`;
  if (heroPercent !== null) style["--hero-spot"] = `${heroPercent}%`;

  return (
    <div
      className={cx(
        styles.timeline,
        previewStill && styles.previewing,
        !previewStill && highlightedIndex >= 0 && styles.linked,
        heroPercent !== null && showHero && !heroMark.fading && styles.heroShown
      )}
      style={Object.keys(style).length ? style : undefined}
    >
      <div
        ref={stripRef}
        className={styles.strip}
        role="slider"
        tabIndex={0}
        aria-label="Film stills timeline"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={valueIndex + 1}
        aria-valuetext={`Still ${valueIndex + 1} of ${count}, ${formatMomentToHms(stills[valueIndex]?.time_seconds)}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={hidePreview}
      >
        <DensityBars bins={bins} className={styles.bars} />
        <DensityBars bins={bins} className={cx(styles.bars, styles.barsLit)} />
        {heroPercent !== null && <DensityBars bins={bins} className={cx(styles.bars, styles.barsHero)} />}
        {selectedIndex >= 0 && (
          <span className={cx(styles.mark, styles.selectedMark)} style={{ left: `${percentOf(selectedIndex)}%` }} />
        )}
        {previewStill && (
          <span className={cx(styles.mark, styles.playhead)} style={{ left: `${percentOf(cursor.index)}%` }} />
        )}
        {pendingSeconds !== null && (
          <span
            className={cx(styles.mark, styles.pendingMark)}
            style={{ left: `${getTimelinePositionPercent({ time_seconds: pendingSeconds }, runtimeSeconds)}%` }}
          >
            <span className={styles.pendingLabel}>+ {formatMomentToHms(pendingSeconds)}</span>
          </span>
        )}
      </div>

      {previewStill && (
        <StillPreview
          still={previewStill}
          index={cursor.index}
          percent={percentOf(cursor.index)}
          total={count}
        />
      )}

      <div className={styles.scale} aria-hidden="true">
        {scale.ticks.map((tick) => (
          <span
            key={tick.seconds}
            className={cx(styles.tick, tick.major && styles.tickMajor)}
            style={{ left: `${tick.percent}%` }}
          />
        ))}
        <span className={cx(styles.label, styles.labelStart)}>00:00:00</span>
        {scale.labels.map((label, i) => (
          <span
            key={label.seconds}
            // Every other label drops out on narrow screens.
            className={cx(styles.label, i % 2 === 0 && styles.labelOptional)}
            style={{ left: `${label.percent}%` }}
          >
            {formatSecondsToHms(label.seconds)}
          </span>
        ))}
        <span className={cx(styles.label, styles.labelEnd)}>{formatSecondsToHms(runtimeSeconds)}</span>
      </div>
    </div>
  );
}
