import { memo, useState } from "react";
import { Page } from "react-pdf";
import { findLineAtY } from "@/shared/lib/pdf-text/pageTextLines.js";
import { formatSecondsToHms } from "@/shared/lib/time.js";
import styles from "./PdfPageFrame.module.css";

const OVERLAY_CONTROL = "[data-overlay-control]";
const LETTER_ASPECT_RATIO = 11 / 8.5;

function AnchorMarker({ kind, anchor, scale, onRemove }) {
  const y = (kind === "start" ? anchor.top : anchor.bottom) * scale;
  const label = kind === "start" ? "Start" : "End";

  return (
    <div
      className={`${styles.anchor} ${kind === "start" ? styles.start : styles.end} ${
        anchor.suggested ? styles.suggested : ""
      }`}
      style={{ top: y }}
    >
      <span className={styles.anchorRule} />
      <span className={styles.anchorTab} data-overlay-control>
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d={kind === "start" ? "M1 2h8L5 8z" : "M1 8h8L5 2z"} fill="currentColor" />
        </svg>
        {anchor.suggested ? `Suggested ${label.toLowerCase()}` : label}
        {!anchor.suggested && (
          <button
            type="button"
            className={styles.anchorRemove}
            aria-label={`Remove ${kind} anchor`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(kind);
            }}
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * One PDF page plus its annotation overlay: anchor markers, the captured
 * range, a snap line under the pointer, and saved-scene bars in the right
 * margin. Props are primitives or stable references so only pages whose
 * overlay actually changes re-render. With `readOnly` (visitors), the page
 * keeps the scene bars but offers no anchor menu or line highlight.
 */
export const PdfPageFrame = memo(function PdfPageFrame({
  pageNumber,
  pageIndex,
  pageWidth,
  inWindow,
  placeholderHeight,
  compact,
  readOnly = false,
  devicePixelRatio,
  startAnchor,
  endAnchor,
  rangeTop,
  rangeBottom,
  sceneSegments,
  activeSceneId,
  onLineContextMenu,
  onHoverLine,
  onRemoveAnchor,
  onSelectScene,
  onRendered,
}) {
  const [hoverLineIndex, setHoverLineIndex] = useState(null);
  const scale = pageIndex ? pageWidth / pageIndex.width : 0;
  const hoverLine = hoverLineIndex === null ? null : pageIndex?.lines[hoverLineIndex] ?? null;
  const isActive = Boolean(activeSceneId) && sceneSegments.some((segment) => segment.scene.id === activeSceneId);
  const loadingHeight = Math.round(
    pageIndex ? (pageWidth * pageIndex.height) / pageIndex.width : pageWidth * LETTER_ASPECT_RATIO
  );
  const px = (points) => points * scale;

  function lineAtPointer(event) {
    if (!scale) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    return findLineAtY(pageIndex, (event.clientY - rect.top) / scale);
  }

  function setHover(line) {
    const nextIndex = line ? line.index : null;
    if (nextIndex === hoverLineIndex) return;
    setHoverLineIndex(nextIndex);
    onHoverLine(line ? { pageNumber, line } : null);
  }

  function openMenu(event) {
    event.preventDefault();
    onLineContextMenu({
      pageNumber,
      line: lineAtPointer(event),
      x: event.clientX,
      y: event.clientY,
      indexed: Boolean(pageIndex),
    });
  }

  return (
    <div
      id={`script-page-${pageNumber}`}
      data-page-number={pageNumber}
      className={[styles.frame, compact || readOnly ? "" : styles.interactive, isActive ? styles.active : ""].join(" ")}
      onMouseMove={(event) => {
        if (compact || readOnly) return;
        setHover(event.target.closest(OVERLAY_CONTROL) ? null : lineAtPointer(event));
      }}
      onMouseLeave={() => setHover(null)}
      onContextMenu={(event) => {
        if (!readOnly && !event.target.closest(OVERLAY_CONTROL)) openMenu(event);
      }}
      onClick={(event) => {
        // Touch devices have no right click; a tap opens the anchor menu.
        if (compact && !readOnly && !event.target.closest(OVERLAY_CONTROL)) openMenu(event);
      }}
    >
      {inWindow ? (
        <Page
          pageNumber={pageNumber}
          width={pageWidth}
          devicePixelRatio={devicePixelRatio}
          renderTextLayer={!compact}
          renderAnnotationLayer={!compact}
          loading={<div className={styles.placeholder} style={{ width: pageWidth, height: loadingHeight }} />}
          onRenderSuccess={() => onRendered(pageNumber)}
        />
      ) : (
        <div className={styles.placeholder} style={{ width: pageWidth, height: placeholderHeight }} />
      )}

      {scale > 0 && (
        <div className={styles.overlay}>
          {rangeTop !== null && rangeBottom !== null && (
            <div
              className={styles.range}
              style={{ top: px(rangeTop), height: px(Math.min(rangeBottom, pageIndex.height) - rangeTop) }}
            />
          )}

          {hoverLine && (
            <div
              className={styles.hoverLine}
              style={{ top: px(hoverLine.top), height: px(hoverLine.bottom - hoverLine.top) }}
            >
              <span className={styles.hoverLabel}>L{hoverLine.index + 1}</span>
            </div>
          )}

          {sceneSegments.map((segment) => {
            const top = segment.top === null ? 0 : px(segment.top);
            const bottom = segment.bottom === null ? px(pageIndex.height) : px(segment.bottom);
            const { scene } = segment;
            const timing = `${formatSecondsToHms(scene.start_time_seconds)}–${formatSecondsToHms(
              scene.end_time_seconds
            )}`;
            return (
              <button
                key={scene.id}
                type="button"
                data-overlay-control
                className={[
                  styles.sceneBar,
                  scene.id === activeSceneId ? styles.sceneBarActive : "",
                  segment.approximate ? styles.sceneBarApprox : "",
                ].join(" ")}
                style={{ top, height: Math.max(10, bottom - top), right: 8 + segment.lane * 10 }}
                title={`Scene ${timing}${segment.approximate ? " · page range only" : ""}`}
                aria-label={`${readOnly ? "View" : "Edit"} scene ${timing}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectScene(scene);
                }}
              >
                {segment.isStart && (
                  <span className={styles.sceneChip}>{formatSecondsToHms(scene.start_time_seconds)}</span>
                )}
              </button>
            );
          })}

          {startAnchor && <AnchorMarker kind="start" anchor={startAnchor} scale={scale} onRemove={onRemoveAnchor} />}
          {endAnchor && <AnchorMarker kind="end" anchor={endAnchor} scale={scale} onRemove={onRemoveAnchor} />}
        </div>
      )}
    </div>
  );
});
