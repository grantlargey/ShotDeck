import { normalizeScreenplayType } from "./elements.js";

/*
 * ScriptDeck screenplay markdown
 * ------------------------------
 * A small markdown-based format where every block is one screenplay element.
 * Blocks are separated by a blank line; simultaneous speeches use a custom
 * two-column fence around ordinary speech blocks.
 *
 *   ## INT. DEPT. OF HEALTH, OFFICE - MORNING      scene heading
 *   Plain paragraph                                action
 *   ### JOKER (V.O.)                               character cue
 *   > dialogue paragraph                           dialogue
 *   > > (beat)                                     parenthetical (inside the quote)
 *   #### CLOSE ON THE CARD                         shot
 *   <p align="right">CUT TO:</p>                   transition
 *   <p align="center">THE END</p>                  centered text
 *
 * Dialogue and parentheticals that belong to one speech share a single quote
 * block; `>` on its own separates their paragraphs:
 *
 *   ### SOCIAL WORKER
 *
 *   > It's certainly tense.
 *   >
 *   > > (then)
 *   >
 *   > How 'bout you.
 *
 * Simultaneous speeches use two columns, each containing cues, dialogue and
 * parentheticals in reading order. Cues may be absent in partial captures:
 *
 *   ::: dual-dialogue
 *   ### MAYA
 *
 *   > Wait!
 *   ::: column
 *   ### ARTHUR
 *
 *   > Go!
 *   :::
 *
 * The server formatter prompt describes the same grammar
 * (server/src/services/screenplay-format.service.js); keep them in sync.
 */

const QUOTE_LINE = /^ {0,3}>/;
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const ALIGNED_BLOCK_OPEN = /^ {0,3}<(p|div|h[1-6])\b[^>]*?\balign\s*=\s*["']?(left|right|center)["']?[^>]*>/i;
const BLOCK_START = /^ {0,3}(?:#{1,6}[ \t]|>|<(?:p|div|h[1-6])\b[^>]*?\balign)/i;
const ESCAPED_LINE_START = /^\\(?=[#><]|:::)/;
const DUAL_START = /^ {0,3}:::[ \t]+dual-dialogue[ \t]*$/;
const DUAL_COLUMN = /^ {0,3}:::[ \t]+column[ \t]*$/;
const DUAL_END = /^ {0,3}:::[ \t]*$/;
const SPEECH_TYPES = new Set(["character", "dialogue", "parenthetical"]);

function isBlockStart(line) {
  return BLOCK_START.test(line) || DUAL_START.test(line) || DUAL_COLUMN.test(line) || DUAL_END.test(line);
}

const HEADING_LEVEL_TYPES = {
  1: "centered",
  2: "heading",
  3: "character",
  4: "shot",
  5: "shot",
  6: "shot",
};

const ALIGN_TYPES = { right: "transition", center: "centered", left: "action" };

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function decodeHtml(text) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => HTML_ENTITIES[name]);
}

function encodeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripQuoteMarker(line) {
  return line.replace(/^ {0,3}> ?/, "");
}

function toSingleLine(text) {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Joins a wrapped line onto the previous one, re-joining words hyphenated
 * across the line break ("grease-" + "paint") but not dashes ("hands--").
 */
export function joinWrappedLine(previous, next) {
  if (/[A-Za-z]-$/.test(previous) && !/--$/.test(previous) && /^[A-Za-z]/.test(next)) {
    return previous + next;
  }
  return `${previous} ${next}`;
}

function pushQuotedElements(elements, quotedLines) {
  let current = null;
  const flush = () => {
    if (current) elements.push({ type: current.type, text: current.lines.join("\n") });
    current = null;
  };

  for (const line of quotedLines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const nested = QUOTE_LINE.test(line);
    const type = nested ? "parenthetical" : "dialogue";
    if (!current || current.type !== type) {
      flush();
      current = { type, lines: [] };
    }
    current.lines.push(nested ? stripQuoteMarker(line).trim() : line.trim());
  }
  flush();
}

function readDualDialogue(lines, start) {
  let depth = 1;
  let nested = false;
  let end = lines.length;
  const separators = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (DUAL_START.test(lines[index])) {
      depth += 1;
      nested = true;
    } else if (DUAL_END.test(lines[index])) {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    } else if (DUAL_COLUMN.test(lines[index]) && depth === 1) {
      separators.push(index);
    }
  }

  if (!nested && end < lines.length && separators.length === 1) {
    const separator = separators[0];
    const columns = [lines.slice(start + 1, separator), lines.slice(separator + 1, end)]
      .map((column) => parseScreenplayMarkdown(column.join("\n")));
    if (columns.every((column) => column.every((element) => SPEECH_TYPES.has(element.type)))) {
      return { element: { type: "dualDialogue", columns }, next: end + 1 };
    }
  }

  // A damaged fence must retain its complete source, including headings and
  // quote markers, rather than silently consuming words or one of its columns.
  return {
    element: { type: "action", text: lines.slice(start, end + 1).join("\n").trim() },
    next: Math.min(end + 1, lines.length),
  };
}

/**
 * Parses screenplay markdown into `{ type, text }` elements and nested
 * `{ type: "dualDialogue", columns: [leftElements, rightElements] }` groups. Text with no
 * grammar markers is valid too: each paragraph, separated by a blank line, is
 * one action element, and its line breaks are kept as written.
 */
export function parseScreenplayMarkdown(source) {
  const normalized = String(source ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (DUAL_START.test(line)) {
      const { element, next } = readDualDialogue(lines, i);
      elements.push(element);
      i = next;
      continue;
    }

    if (QUOTE_LINE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE_LINE.test(lines[i])) {
        quoted.push(stripQuoteMarker(lines[i]));
        i += 1;
      }
      pushQuotedElements(elements, quoted);
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      elements.push({ type: HEADING_LEVEL_TYPES[heading[1].length], text: heading[2].trim() });
      i += 1;
      continue;
    }

    const aligned = ALIGNED_BLOCK_OPEN.exec(line);
    if (aligned) {
      const closeTag = new RegExp(`</${aligned[1]}\\s*>`, "i");
      const collected = [line.slice(aligned[0].length)];
      while (!closeTag.test(collected[collected.length - 1]) && i + 1 < lines.length && lines[i + 1].trim()) {
        i += 1;
        collected.push(lines[i]);
      }
      i += 1;
      const inner = collected.join("\n").split(closeTag)[0];
      elements.push({ type: ALIGN_TYPES[aligned[2].toLowerCase()], text: decodeHtml(inner).trim() });
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !isBlockStart(lines[i]))) {
      paragraph.push(lines[i].replace(ESCAPED_LINE_START, "").trimEnd());
      i += 1;
    }
    elements.push({ type: "action", text: paragraph.join("\n").trim() });
  }

  return elements.filter((element) => element.type === "dualDialogue" || element.text);
}

function serializeBlock(type, text) {
  switch (type) {
    case "heading":
      return `## ${toSingleLine(text)}`;
    case "character":
      return `### ${toSingleLine(text)}`;
    case "shot":
      return `#### ${toSingleLine(text)}`;
    case "transition":
      return `<p align="right">${encodeHtml(toSingleLine(text))}</p>`;
    case "centered":
      return `<p align="center">${text.split("\n").map((line) => encodeHtml(line.trim())).join("<br>")}</p>`;
    default:
      return text
        .split("\n")
        .map((line) => (isBlockStart(line) ? `\\${line.trimStart()}` : line))
        .join("\n");
  }
}

/**
 * Serializes elements back into screenplay markdown. Consecutive dialogue and
 * parentheticals are written into one quote block, matching how a speech
 * reads on the page.
 */
export function serializeScreenplayMarkdown(elements) {
  const blocks = [];
  let quote = null;

  const flushQuote = () => {
    if (quote) blocks.push(quote.join("\n"));
    quote = null;
  };

  for (const element of Array.isArray(elements) ? elements : []) {
    if (element?.type === "dualDialogue" && Array.isArray(element.columns)) {
      flushQuote();
      const columns = element.columns.map((column) => serializeScreenplayMarkdown(column));
      blocks.push(`::: dual-dialogue\n${columns.join("\n::: column\n")}\n:::`);
      continue;
    }

    const type = normalizeScreenplayType(element?.type);
    const text = String(element?.text ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    if (!text) continue;

    if (type === "dialogue" || type === "parenthetical") {
      const prefix = type === "parenthetical" ? "> > " : "> ";
      if (quote) quote.push(">");
      else quote = [];
      for (const line of text.split("\n")) quote.push(line ? `${prefix}${line}` : ">");
      continue;
    }

    flushQuote();
    blocks.push(serializeBlock(type, text));
  }

  flushQuote();
  return blocks.join("\n\n");
}

/**
 * Reading-order plain text: one element per paragraph. Used as the stored raw
 * transcript and as the baseline for word-fidelity checks.
 */
export function screenplayToPlainText(input) {
  const elements = Array.isArray(input) ? input : parseScreenplayMarkdown(input);
  return elements
    .map((element) => element.type === "dualDialogue" && Array.isArray(element.columns)
      ? element.columns.map((column) => screenplayToPlainText(column)).filter(Boolean).join("\n\n")
      : String(element.text || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function getScreenplaySceneHeading(input) {
  const elements = Array.isArray(input) ? input : parseScreenplayMarkdown(input);
  return elements.find((element) => element.type === "heading")?.text || "";
}
