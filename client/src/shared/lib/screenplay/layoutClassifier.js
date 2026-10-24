import { assembleLineText, lineBoxAt } from "../pdf-text/pageTextLines.js";
import { joinWrappedLine } from "./grammar.js";

/*
 * Layout-based screenplay classification.
 *
 * Screenplay PDFs follow a near-universal page layout, measured from the
 * action margin (usually 1.5in from the page edge):
 *
 *   action / scene heading / shot   +0in
 *   dialogue                        +1in
 *   parenthetical                   +1.5in
 *   character cue                   +2in
 *   transition                      right-aligned, far right
 *
 * Working from each line's position is deterministic, free, and preserves the
 * PDF's words exactly. It also strips non-body artifacts: scene numbers,
 * page numbers, revision asterisks, headers, (MORE) and page-break (CONT'D).
 */

const INCH = 72;
const DEFAULT_ACTION_MARGIN = INCH * 1.5;
const CHAR_WIDTH_RATIO = 0.6;

const SCENE_NUMBER = /^\d{1,4}[A-Z]{0,2}\.?$/;
const SCENE_HEADING = /^(?:INT|EXT|EST|I\/E)\b[.\s/-]/i;
const NUMBERED_HEADING = /^(\d{1,4}[A-Z]{0,2})\s+(.+?)\s+\1$/;
const SHOT_PREFIX =
  /^(?:ANGLE ON|CLOSE ON|CLOSE UP|CLOSE-UP|CLOSEUP|EXTREME CLOSE|WIDE (?:SHOT|ANGLE)|INSERT|POV|P\.O\.V\.|REVERSE ANGLE|OVERHEAD|AERIAL|TRACKING SHOT|BACK TO SCENE|SERIES OF SHOTS|SPLIT SCREEN)\b/;
const TRANSITION_TEXT =
  /(?:\bTO:|\bIN:|\bOUT[.:]?$|\bCUTS?:|\bBLACK[.:]|^FADE\b|^CUT\b|^SMASH\b|^MATCH\b|^DISSOLVE\b|^INTERCUT\b|^WIPE\b|^IRIS\b)/;
const MORE_MARKER = /^\(MORE\)$/i;
const CONTINUED_MARKER = /^\(?CONTINUED:?\)?(?:\s*\(\d+\))?$/i;
const CONTINUATION_EXTENSION = /\((?:CONT['’]?D|CONT\.|CONTINUING)\)/i;
const PAGE_NUMBER = /^\d{1,4}[A-Z]?\.?$/;

function isUppercase(text) {
  return /[A-Z]/.test(text) && text === text.toUpperCase();
}

function cueName(text) {
  return text.replace(/\s*\([^)]*\)/g, "").trim();
}

function isCueText(text) {
  const name = cueName(text);
  return name.length > 0 && name.length <= 40 && isUppercase(name) && !/[:!?]$/.test(name);
}

function isParenClosed(text) {
  return (text.match(/\(/g) || []).length <= (text.match(/\)/g) || []).length;
}

function columnZone(offsetFromMargin) {
  if (offsetFromMargin < INCH * 0.5) return "left";
  if (offsetFromMargin < INCH * 1.25) return "dialogue";
  if (offsetFromMargin < INCH * 1.8) return "paren";
  if (offsetFromMargin < INCH * 3.2) return "cue";
  return "right";
}

// Keep the gaps that separate simultaneous speeches. PDF producers may emit
// one run per word, one per column, or both columns in a space-padded run.
function positionedTextRuns(items, fontSize) {
  return items.flatMap((item) => {
    const advance = (item.right - item.x) / item.str.length || fontSize * CHAR_WIDTH_RATIO;
    return [...item.str.matchAll(/\S(?:.*?\S)?(?=\s{3,}|\s*$)/g)].map((match) => ({
      str: match[0],
      x: item.x + match.index * advance,
      right: item.x + (match.index + match[0].length) * advance,
    }));
  });
}

function textClusters(items, fontSize) {
  const clusters = [];
  for (const item of positionedTextRuns(items, fontSize)) {
    const previous = clusters.at(-1);
    if (previous && item.x - previous.right < fontSize * 1.5) {
      previous.items.push(item);
      previous.right = Math.max(previous.right, item.right);
    } else {
      clusters.push({ left: item.x, right: item.right, items: [item] });
    }
  }
  return clusters.map((cluster) => ({ ...cluster, text: assembleLineText(cluster.items, fontSize) }));
}

/**
 * Finds two simultaneous speeches before same-baseline text is flattened.
 * Require two separated cues and two speech columns immediately below them;
 * ordinary indents, uppercase action, and widely spaced words alone do not
 * establish dual dialogue. A common empty gutter must survive every row.
 */
function dualDialogueGroups(lines) {
  const groups = new Map();
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const cue = lines[i];
    const cues = textClusters(cue.items, cue.fontSize);
    if (cues.length !== 2 || cues[1].left - cues[0].right < cue.fontSize * 4) continue;
    if (!cues.every(({ text }) => isCueText(text) && !SCENE_HEADING.test(text) &&
      !SHOT_PREFIX.test(text) && !TRANSITION_TEXT.test(text))) continue;

    const first = lines[i + 1];
    if (first.baseline - cue.baseline > cue.fontSize * 1.75) continue;
    const speeches = textClusters(first.items, first.fontSize);
    if (speeches.length !== 2 || speeches.some((speech, column) => speech.left > cues[column].left + cue.fontSize)) continue;

    let gutterLeft = Math.max(cues[0].right, speeches[0].right);
    let gutterRight = Math.min(cues[1].left, speeches[1].left);
    if (gutterRight - gutterLeft < cue.fontSize) continue;

    const rows = [cue, first];
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.baseline - rows.at(-1).baseline > Math.max(line.fontSize, rows.at(-1).fontSize) * 1.6) break;
      const runs = positionedTextRuns(line.items, line.fontSize);
      // Include outside gaps: one speaker can finish before the other.
      const gaps = runs.map((run, index) => [index ? runs[index - 1].right : -Infinity, run.x]);
      gaps.push([runs.at(-1)?.right ?? -Infinity, Infinity]);
      const gap = gaps.map(([left, right]) => [Math.max(left, gutterLeft), Math.min(right, gutterRight)])
        .find(([left, right]) => right - left >= line.fontSize * CHAR_WIDTH_RATIO);
      if (!gap) break;
      [gutterLeft, gutterRight] = gap;
      rows.push(line);
    }

    const divider = (gutterLeft + gutterRight) / 2;
    const previousTypes = [null, null];
    const parenTexts = ["", ""];
    const group = rows.map((line, rowIndex) => ({
      ...line,
      columns: [0, 1].map((column) => {
        const runs = positionedTextRuns(line.items, line.fontSize)
          .filter((run) => (run.x < divider ? 0 : 1) === column);
        const text = assembleLineText(runs, line.fontSize);
        if (!text || MORE_MARKER.test(text)) return null;
        const continuesParen = previousTypes[column] === "parenthetical" && !isParenClosed(parenTexts[column]);
        const type = rowIndex === 0 ? "character" : text.startsWith("(") || continuesParen ? "parenthetical" : "dialogue";
        parenTexts[column] = type === "parenthetical" ? (continuesParen ? `${parenTexts[column]} ${text}` : text) : "";
        previousTypes[column] = type;
        return { type, text };
      }),
    }));
    for (const row of rows) groups.set(row.baseline, group);
    i += rows.length - 1;
  }
  return groups;
}

function selectedDualDialogue(group, selectedBaselines) {
  const columns = [[], []];
  const rows = group.filter((line) => selectedBaselines.has(line.baseline));
  for (const row of rows) {
    row.columns.forEach((element, column) => {
      if (!element) return;
      const previous = columns[column].at(-1);
      if (previous && previous.type === element.type && element.type !== "character") {
        previous.text = joinWrappedLine(previous.text, element.text);
      } else columns[column].push({ ...element });
    });
  }
  return { type: "dualDialogue", columns, page: rows[0].page, baseline: rows[0].baseline, endBaseline: rows.at(-1).baseline };
}

/**
 * Estimates the action margin as the most common left edge of long lines;
 * dialogue columns are too narrow to produce lines this long.
 */
export function estimateActionMargin(pages) {
  const counts = new Map();

  for (const page of pages || []) {
    for (const line of page?.lines || []) {
      if (line.text.length < 45) continue;
      const items = line.items || [];
      const first = items[0]?.str.trim();
      const left = first && SCENE_NUMBER.test(first) && items[1] ? items[1].x : line.left;
      // Two narrow speeches on one baseline are not one long action line.
      if (!textClusters(items.filter((item) => item.x >= left), line.fontSize)
        .some((cluster) => cluster.text.length >= 45)) continue;
      const key = Math.round(left);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  let best = null;
  let bestCount = 0;
  for (const [x, count] of counts) {
    if (count > bestCount || (count === bestCount && x < best)) {
      best = x;
      bestCount = count;
    }
  }
  return best;
}

function cleanLayoutLine(line, page, margin) {
  if (line.baseline < page.height * 0.075 || line.baseline > page.height - 24) return null;

  const charWidth = line.fontSize * CHAR_WIDTH_RATIO;
  const items = (line.items || [])
    .filter((item) => item.str.trim())
    .map((item) => ({ ...item, str: item.str.replace(/\s{2,}\*+\s*$/, "") }));

  let leadingNumber = "";
  if (items.length > 1 && SCENE_NUMBER.test(items[0].str.trim()) && items[0].right < margin - charWidth) {
    leadingNumber = items.shift().str.trim();
  }

  // Item widths often include padding spaces, so margin artifacts are found
  // by position rather than by the gap before them. Long headings can even
  // overlap the right-hand scene number.
  while (items.length > 1 && /^\*+$/.test(items[items.length - 1].str.trim()) && items[items.length - 1].x > margin + INCH * 5.5) {
    items.pop();
  }

  // A right-hand scene number repeats the left-hand one, so only that exact
  // number is removed; "... LATER - 1902" keeps its year.
  if (items.length > 1) {
    const last = items[items.length - 1];
    const str = last.str.trim();
    const matchesLeading = leadingNumber ? str === leadingNumber : SCENE_HEADING.test(items[0].str.trim());
    if (matchesLeading && SCENE_NUMBER.test(str) && last.x > margin + INCH * 4.5) items.pop();
  }

  while (items.length > 1 && /^\*+$/.test(items[items.length - 1].str.trim()) && items[items.length - 1].x > margin + INCH * 5.5) {
    items.pop();
  }
  if (!items.length) return null;

  if (items.length === 1) {
    const only = items[0];
    const str = only.str.trim();
    if (/^\*+$/.test(str)) return null;
    if (SCENE_NUMBER.test(str) && (only.right < margin - charWidth || only.x > margin + INCH * 4.5)) return null;
  }

  let text = assembleLineText(items, line.fontSize);
  text = text.replace(NUMBERED_HEADING, (match, _number, body) => (SCENE_HEADING.test(body) ? body : match));
  if (!text) return null;
  if (line.baseline < page.height * 0.12 && PAGE_NUMBER.test(text)) return null;
  if (CONTINUED_MARKER.test(text)) return null;

  const left = items[0].x;
  const right = Math.max(...items.map((item) => item.right));

  return {
    text,
    items,
    left,
    right,
    baseline: line.baseline,
    fontSize: line.fontSize,
    page: page.pageNumber,
    zone: columnZone(left - margin),
    centerOffset: (left + right) / 2 - page.width / 2,
    more: MORE_MARKER.test(text),
  };
}

/**
 * Where a page's scene headings sit, without their scene numbers or revision
 * marks, as line boxes in PDF points. The page alone gives the action margin
 * unless one is passed. The script viewer tints these in page styles with
 * colored headings.
 */
export function sceneHeadingBoxes(page, actionMargin = estimateActionMargin([page]) ?? DEFAULT_ACTION_MARGIN) {
  const boxes = [];
  for (const line of page?.lines || []) {
    const cleaned = cleanLayoutLine(line, page, actionMargin);
    if (cleaned?.zone !== "left" || !SCENE_HEADING.test(cleaned.text)) continue;
    boxes.push({ left: cleaned.left, right: cleaned.right, ...lineBoxAt(line.baseline, line.fontSize) });
  }
  return boxes;
}

/**
 * Classifies positioned lines into screenplay elements.
 *
 * @param pages Pages in reading order: `{ pageNumber, width, height, lines }`
 *   where `lines` come from buildPageTextLines (optionally limited to a range).
 * @param options.actionMargin Document-level action margin in points.
 * @param options.contextPages Untrimmed pages used only to recognize dual
 *   dialogue when an anchor starts or ends inside one of its speeches.
 */
export function screenplayElementsFromLayout(pages, options = {}) {
  const margin = options.actionMargin ?? estimateActionMargin(pages) ?? DEFAULT_ACTION_MARGIN;

  const lines = [];
  const contextPages = new Map((options.contextPages || []).map((page) => [page.pageNumber, page]));
  for (const page of pages || []) {
    const clean = (source) => (source.lines || []).map((line) => cleanLayoutLine(line, source, margin)).filter(Boolean);
    const selected = clean(page);
    const context = contextPages.get(page.pageNumber);
    const groups = dualDialogueGroups(context ? clean(context) : selected);
    const selectedBaselines = new Set(selected.map((line) => line.baseline));
    const emitted = new Set();
    for (const line of selected) {
      const group = groups.get(line.baseline);
      if (!group) lines.push(line);
      else if (!emitted.has(group)) {
        lines.push(selectedDualDialogue(group, selectedBaselines));
        emitted.add(group);
      }
    }
  }

  const elements = [];
  let current = null;
  let previous = null;
  let inSpeech = false;
  let lastCue = "";
  let pendingMore = false;

  const push = (type, text) => {
    current = { type, text };
    elements.push(current);
  };
  const append = (text) => {
    current.text = joinWrappedLine(current.text, text);
  };
  const addDialogue = (text, joinable) => {
    if (current?.type === "dialogue" && joinable) append(text);
    else push("dialogue", text);
    inSpeech = true;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.type === "dualDialogue") {
      elements.push({ type: line.type, columns: line.columns });
      current = null;
      previous = { ...line, baseline: line.endBaseline };
      inSpeech = false;
      lastCue = "";
      pendingMore = false;
      continue;
    }
    if (line.more) {
      pendingMore = true;
      continue;
    }

    let next = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j].more) {
        next = lines[j];
        break;
      }
    }

    const { text, zone } = line;
    const pageBreak = Boolean(previous) && previous.page !== line.page;
    const lineGap = Math.max(line.fontSize, previous?.fontSize ?? 0) * 1.6;
    const tight = Boolean(previous) && !pageBreak && line.baseline - previous.baseline <= lineGap;
    const continuing = pendingMore && pageBreak;
    const parenOpen = current?.type === "parenthetical" && !isParenClosed(current.text);

    // Speeches are single-spaced; a blank line (or a page break without
    // (MORE)) ends the speech.
    if (!tight && !continuing) inSpeech = false;

    if (zone === "left") {
      inSpeech = false;
      const nextIsTight =
        next && next.page === line.page && next.zone === "left" && next.baseline - line.baseline <= lineGap;
      if (SCENE_HEADING.test(text)) push("heading", text);
      else if (tight && ["action", "heading", "shot"].includes(current?.type)) append(text);
      else if (isUppercase(text) && SHOT_PREFIX.test(text) && !nextIsTight) push("shot", text);
      else push("action", text);
    } else if (parenOpen && (tight || continuing) && zone !== "right") {
      append(text);
      inSpeech = true;
    } else if (zone === "paren") {
      if (text.startsWith("(")) {
        push("parenthetical", text);
        inSpeech = true;
      } else if (inSpeech || !previous) {
        addDialogue(text, tight || continuing);
      } else {
        push("action", text);
      }
    } else if (zone === "dialogue") {
      if (inSpeech || !previous || continuing) addDialogue(text, tight || continuing);
      else push("action", text);
    } else if (zone === "cue") {
      const followedBySpeech =
        !next ||
        next.page !== line.page ||
        (next.baseline - line.baseline <= line.fontSize * 1.75 &&
          (next.zone === "dialogue" || next.zone === "paren"));

      if (isCueText(text) && followedBySpeech) {
        const name = cueName(text);
        const repeatsSpeaker = continuing && CONTINUATION_EXTENSION.test(text) && name === lastCue;
        if (!repeatsSpeaker) {
          push("character", text);
          lastCue = name;
        }
        inSpeech = true;
      } else if (inSpeech) {
        addDialogue(text, tight || continuing);
      } else if (Math.abs(line.centerOffset) <= INCH * 0.4) {
        push("centered", text);
      } else if (isUppercase(text) && TRANSITION_TEXT.test(text)) {
        push("transition", text);
      } else {
        push("action", text);
      }
    } else {
      inSpeech = false;
      push("transition", text);
    }

    previous = line;
    pendingMore = false;
  }

  return elements;
}
