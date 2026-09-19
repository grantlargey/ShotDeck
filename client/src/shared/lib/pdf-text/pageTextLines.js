const ASCENT_RATIO = 0.82;
const DESCENT_RATIO = 0.24;
const AVERAGE_CHAR_WIDTH_RATIO = 0.6;

/**
 * Joins positioned text runs into one line, inserting a space wherever the
 * horizontal gap between runs is wider than a fraction of a character. Some
 * PDFs emit one run per word with no space characters at all.
 */
export function assembleLineText(items, fontSize) {
  const minGap = fontSize * AVERAGE_CHAR_WIDTH_RATIO * 0.3;
  let text = "";
  let previousRight = null;

  for (const item of items) {
    const str = item.str.replace(/\s+/g, " ");
    if (previousRight !== null && item.x - previousRight > minGap && !text.endsWith(" ") && !str.startsWith(" ")) {
      text += " ";
    }
    text += str;
    previousRight = item.right;
  }

  return text.replace(/\s+/g, " ").trim();
}

/**
 * Some PDFs fake bold text by drawing the same run twice with a tiny offset,
 * which would otherwise read as "SENATESENATE".
 */
function removeDuplicateRuns(items, fontSize) {
  const kept = [];
  for (const item of items) {
    const duplicate = kept.some(
      (other) => other.str === item.str && Math.abs(other.x - item.x) < fontSize * 0.3
    );
    if (!duplicate) kept.push(item);
  }
  return kept;
}

/**
 * Converts pdf.js text content into visual lines with geometry in PDF points
 * (scale 1, top-left origin). Line geometry drives anchor snapping, capture,
 * and layout-based screenplay classification, independent of render zoom.
 */
export function buildPageTextLines(textContent, viewport, pageNumber) {
  const runs = [];

  for (const item of textContent?.items || []) {
    if (typeof item?.str !== "string" || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform;
    // Rotated runs are watermarks or margin notes, not script body text.
    if (Math.abs(b) > Math.abs(a) * 0.1) continue;
    const fontSize = Math.abs(d) || Math.hypot(c, d);
    if (fontSize < 3) continue;

    const [x, baseline] = viewport.convertToViewportPoint(e, f);
    runs.push({ str: item.str, x, right: x + item.width * viewport.scale, baseline, fontSize });
  }

  runs.sort((left, right) => left.baseline - right.baseline || left.x - right.x);

  const grouped = [];
  for (const run of runs) {
    const line = grouped[grouped.length - 1];
    const tolerance = Math.max(1.5, Math.min(run.fontSize, line?.fontSize ?? run.fontSize) * 0.35);
    if (line && Math.abs(run.baseline - line.baseline) <= tolerance) {
      line.items.push(run);
      line.fontSize = Math.max(line.fontSize, run.fontSize);
    } else {
      grouped.push({ baseline: run.baseline, fontSize: run.fontSize, items: [run] });
    }
  }

  const lines = grouped.map((line, index) => {
    const items = removeDuplicateRuns(line.items.sort((left, right) => left.x - right.x), line.fontSize);
    const text = assembleLineText(items, line.fontSize);
    return {
      index,
      baseline: line.baseline,
      fontSize: line.fontSize,
      top: line.baseline - line.fontSize * ASCENT_RATIO,
      bottom: line.baseline + line.fontSize * DESCENT_RATIO,
      left: items[0].x,
      right: Math.max(...items.map((item) => item.right)),
      text,
      items,
    };
  });

  return {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    lines,
  };
}

/**
 * Finds the line under a vertical position (PDF points), snapping to the
 * nearest line when the pointer sits in the gap between lines.
 */
export function findLineAtY(page, y, maxDistance) {
  let best = null;
  let bestDistance = Infinity;

  for (const line of page?.lines || []) {
    const distance = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
    if (distance < bestDistance) {
      best = line;
      bestDistance = distance;
    }
    if (line.top > y && distance > bestDistance) break;
  }

  const limit = maxDistance ?? (best ? best.fontSize * 1.2 : 0);
  return best && bestDistance <= limit ? best : null;
}
