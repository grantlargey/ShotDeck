import { memo, useMemo, useState } from "react";
import { Page } from "react-pdf";
import { formatFilmTiming } from "@/entities/script-scene/model/filmTiming.js";
import { cx } from "@/shared/lib/cx.js";
import { findLineAtY } from "@/shared/lib/pdf-text/pageTextLines.js";
import { sceneHeadingBoxes } from "@/shared/lib/screenplay/layoutClassifier.js";
import { formatSecondsToHms } from "@/shared/lib/time.js";
import { ANCHOR_NAMES } from "../model/anchorNames.js";
import styles from "./PdfPageFrame.module.css";

const OVERLAY_CONTROL = "[data-overlay-control]";
const LETTER_ASPECT_RATIO = 11 / 8.5;
// How far the bracket runs on, fading, from an anchor whose partner isn't placed yet.
const OPEN_BRACKET_PX = 96;
// Saved scenes' brackets in the right margin: how far in from the page's edge,
// and the step between scenes that overlap on the page.
const SCENE_INSET_PX = 6;
const SCENE_LANE_PX = 14;

/**
 * Begin or End on the page: a dotted hairline at the edge of its line, and its
 * name in the margin, with a button that removes it.
 */
function AnchorMarker({ kind, box, scale, onRemove }) {
  const y = (kind === "start" ? box.top : box.bottom) * scale;
  const name = ANCHOR_NAMES[kind];

  return (
    <div className={cx(styles.anchor, kind === "start" ? styles.start : styles.end)} style={{ top: y }}>
      <span className={styles.anchorRule} />
      <span className={styles.anchorTab} data-overlay-control>
        {name}
        <button
          type="button"
          className={styles.anchorRemove}
          aria-label={`Remove ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(kind);
          }}
        >
          ×
        </button>
      </span>
    </div>
  );
}

/**
 * One PDF page plus its scene overlay: the draft's Begin and End, a bracket
 * down the left margin from one to the other, a band on the line under the
 * pointer, and saved scenes as brackets in the right margin. Props are
 * primitives or stable references so only pages whose overlay actually
 * changes re-render. With `readOnly` (visitors), the page keeps the scene
 * brackets but offers no anchor menu or line highlight.
 *
 * The page shows in the visitor's page style (features/scene-text-style): the
 * PDF recolored by --script-page-filter, its scene headings tinted by
 * --script-heading-tint, and the marks in its --script-mark inks.
 */
export const PdfPageFrame = memo(function PdfPageFrame({
  pageNumber,
  pageIndex,
  pageWidth,
  scale,
  inWindow,
  placeholderHeight,
  compact,
  readOnly = false,
  devicePixelRatio,
  projection = {},
  showAnchorMarkers,
  sceneSegments,
  activeSceneId,
  onLineContextMenu,
  onHoverLine,
  onRemoveAnchor,
  onSelectScene,
  onRendered,
}) {
  const [hoverLineIndex, setHoverLineIndex] = useState(null);
  const hoverLine = hoverLineIndex === null ? null : pageIndex?.lines[hoverLineIndex] ?? null;
  const headings = useMemo(() => (pageIndex ? sceneHeadingBoxes(pageIndex) : []), [pageIndex]);
  const loadingHeight = Math.round(
    pageIndex ? (pageWidth * pageIndex.height) / pageIndex.width : pageWidth * LETTER_ASPECT_RATIO
  );
  const px = (points) => points * scale;
  const pageHeight = pageIndex ? px(pageIndex.height) : 0;
  // Only one anchor placed: its bracket runs on, open, toward where the other will go.
  const openFrom = showAnchorMarkers && !projection.range ? projection.start ?? projection.end : null;

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
      className={cx(styles.frame, !compact && !readOnly && styles.interactive)}
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

      {/* Outside the overlay, which would keep the tint from blending with the page beneath. */}
      {scale > 0 && headings.length > 0 && (
        <div className={styles.headings} aria-hidden="true">
          {headings.map((box) => (
            <span
              key={box.top}
              className={styles.heading}
              style={{ top: px(box.top), left: px(box.left), width: px(box.right - box.left), height: px(box.bottom - box.top) }}
            />
          ))}
        </div>
      )}

      {scale > 0 && (
        <div className={styles.overlay}>
          {showAnchorMarkers && projection.range && (
            <div
              className={cx(styles.bracket, projection.start && styles.bracketStart, projection.end && styles.bracketEnd)}
              style={{ top: px(projection.range.top), height: px(projection.range.bottom - projection.range.top) }}
            />
          )}

          {openFrom && (
            <div
              className={cx(styles.openBracket, projection.start ? styles.openDown : styles.openUp)}
              style={
                projection.start
                  ? { top: px(openFrom.top), height: Math.min(OPEN_BRACKET_PX, pageHeight - px(openFrom.top)) }
                  : {
                      top: Math.max(0, px(openFrom.bottom) - OPEN_BRACKET_PX),
                      height: Math.min(OPEN_BRACKET_PX, px(openFrom.bottom)),
                    }
              }
            />
          )}

          {hoverLine && (
            <div
              className={styles.hoverLine}
              style={{ transform: `translateY(${px(hoverLine.top)}px)`, height: px(hoverLine.bottom - hoverLine.top) }}
            >
              <span className={styles.hoverLabel}>L{hoverLine.index + 1}</span>
            </div>
          )}

          {sceneSegments.map((segment) => {
            const top = px(segment.top);
            const bottom = px(segment.bottom);
            const { scene } = segment;
            const timing = formatFilmTiming(scene);
            return (
              <button
                key={scene.id}
                type="button"
                data-overlay-control
                className={cx(
                  styles.sceneBracket,
                  segment.isStart && styles.sceneBracketStart,
                  segment.isEnd && styles.sceneBracketEnd,
                  scene.id === activeSceneId && styles.sceneBracketActive
                )}
                style={{ top, height: Math.max(10, bottom - top), right: SCENE_INSET_PX + segment.lane * SCENE_LANE_PX }}
                title={`Scene ${timing}`}
                aria-label={`${readOnly ? "View" : "Edit"} scene ${timing}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectScene(scene);
                }}
              >
                <span className={styles.sceneBracketLine} />
                {segment.isStart && (
                  <span className={styles.sceneTime}>{formatSecondsToHms(scene.start_time_seconds)}</span>
                )}
              </button>
            );
          })}

          {showAnchorMarkers && projection.start && (
            <AnchorMarker kind="start" box={projection.start} scale={scale} onRemove={onRemoveAnchor} />
          )}
          {showAnchorMarkers && projection.end && (
            <AnchorMarker kind="end" box={projection.end} scale={scale} onRemove={onRemoveAnchor} />
          )}
        </div>
      )}
    </div>
  );
});
