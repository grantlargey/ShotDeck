import { assembleLineText } from "../pdf-text/pageTextLines.js";
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
 * Classifies positioned lines into screenplay elements.
 *
 * @param pages Pages in reading order: `{ pageNumber, width, height, lines }`
 *   where `lines` come from buildPageTextLines (optionally limited to a range).
 * @param options.actionMargin Document-level action margin in points.
 */
export function screenplayElementsFromLayout(pages, options = {}) {
  const margin = options.actionMargin ?? estimateActionMargin(pages) ?? DEFAULT_ACTION_MARGIN;

  const lines = [];
  for (const page of pages || []) {
    for (const line of page.lines || []) {
      const cleaned = cleanLayoutLine(line, page, margin);
      if (cleaned) lines.push(cleaned);
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
