import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  findNearestAnnotationIndex,
  getTimelineBins,
  getTimelinePositionPercent,
  getTimelineScale,
} from "@/entities/annotation/model/annotationTimeline.js";
import { getStillThumbnail } from "@/entities/annotation/model/still.js";
import { cx } from "@/shared/lib/cx.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { formatMomentToHms, formatSecondsToHms } from "@/shared/lib/time.js";
import styles from "./AnnotationTimeline.module.css";

// One density bar per this many pixels of strip width.
const PX_PER_BAR = 6;
const MIN_BARS = 24;
const BAR_MIN_HEIGHT = 5;
const BAR_MAX_HEIGHT = 24;

const KEY_STEPS = new Map([
  ["ArrowRight", 1],
  ["ArrowUp", 1],
  ["ArrowLeft", -1],
  ["ArrowDown", -1],
  ["PageUp", 10],
  ["PageDown", -10],
]);

const clampIndex = (index, count) => Math.min(count - 1, Math.max(0, index));

/** One bar per slice of the runtime. Drawn twice (resting and lit), so memoized. */
const DensityBars = memo(function DensityBars({ bins, className }) {
  const max = Math.max(1, ...bins);

  return (
    <div className={className} aria-hidden="true">
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
    </div>
  );
});

function StillPreview({ annotation, index, percent, total }) {
  const thumbnail = getStillThumbnail(annotation);
  const url = useSignedMediaUrl(thumbnail.key, thumbnail.url);

  return (
    <div className={styles.preview} style={{ "--pos": `${percent}%` }} aria-hidden="true">
      <div className={styles.previewFrame}>{url && <img src={url} alt="" />}</div>
      <div className={styles.previewMeta}>
        <span className={styles.previewTime}>{formatMomentToHms(annotation.time_seconds)}</span>
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
 */
export function AnnotationTimeline({
  annotations,
  highlightedIndex = -1,
  onSelect,
  runtimeSeconds,
  selectedIndex = -1,
}) {
  const stripRef = useRef(null);
  const draggingRef = useRef(false);
  const [binCount, setBinCount] = useState(0);
  // The still being previewed, and where the lit band is centred (the pointer, or the still itself).
  const [preview, setPreview] = useState(null);
  // Where the keyboard picks up: the last still previewed.
  const [cursorIndex, setCursorIndex] = useState(0);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const observer = new ResizeObserver(() => {
      setBinCount(Math.max(MIN_BARS, Math.floor(strip.clientWidth / PX_PER_BAR)));
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  const bins = useMemo(
    () => (binCount ? getTimelineBins(annotations, runtimeSeconds, binCount) : []),
    [annotations, runtimeSeconds, binCount]
  );
  const scale = useMemo(() => getTimelineScale(runtimeSeconds), [runtimeSeconds]);

  const count = annotations.length;
  const percentOf = (index) => getTimelinePositionPercent(annotations[index], runtimeSeconds);

  function showStill(index, spot) {
    const next = clampIndex(index, count);
    if (next < 0) return;
    setPreview({ index: next, spot: spot ?? percentOf(next) });
    setCursorIndex(next);
  }

  function hidePreview() {
    setPreview(null);
  }

  function pointerPercent(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
  }

  function previewAtPointer(event) {
    const percent = pointerPercent(event);
    showStill(findNearestAnnotationIndex(annotations, runtimeSeconds, percent), percent);
  }

  function handlePointerDown(event) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewAtPointer(event);
  }

  function handlePointerMove(event) {
    if (event.pointerType === "mouse" || draggingRef.current) previewAtPointer(event);
  }

  // Touch and pen scrub while pressed and open on release; the mouse opens on click.
  function handlePointerUp(event) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const index = findNearestAnnotationIndex(annotations, runtimeSeconds, pointerPercent(event));
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
    const from = preview?.index ?? clampIndex(cursorIndex, count);
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
    if (event.currentTarget.matches(":focus-visible")) showStill(cursorIndex);
  }

  const previewAnnotation = preview ? annotations[preview.index] : null;
  const valueIndex = clampIndex(preview?.index ?? cursorIndex, count);
  const spot = preview?.spot ?? (highlightedIndex >= 0 ? percentOf(highlightedIndex) : null);

  return (
    <div
      className={cx(
        styles.timeline,
        previewAnnotation && styles.previewing,
        !previewAnnotation && highlightedIndex >= 0 && styles.linked
      )}
      style={spot === null ? undefined : { "--spot": `${spot}%` }}
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
        aria-valuetext={`Still ${valueIndex + 1} of ${count}, ${formatMomentToHms(annotations[valueIndex]?.time_seconds)}`}
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
        {highlightedIndex >= 0 && (
          <span className={cx(styles.mark, styles.linkedMark)} style={{ left: `${percentOf(highlightedIndex)}%` }} />
        )}
        {selectedIndex >= 0 && (
          <span className={cx(styles.mark, styles.selectedMark)} style={{ left: `${percentOf(selectedIndex)}%` }} />
        )}
        {previewAnnotation && (
          <span className={cx(styles.mark, styles.playhead)} style={{ left: `${percentOf(preview.index)}%` }} />
        )}
      </div>

      {previewAnnotation && (
        <StillPreview
          annotation={previewAnnotation}
          index={preview.index}
          percent={percentOf(preview.index)}
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
