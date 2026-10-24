import { buildPageTextLines } from "../../pdf-text/pageTextLines.js";

/*
 * The reported Joker capture, from joker_final.pdf page 97 (printed page 95).
 * These eight baselines retain the original pdf.js positions and widths,
 * the unequal dialogue lengths. Only the reported excerpt is included.
 */
const runs = [
  [585, 252, 35.2, "JOKER"],
  [597, 180, 217.2, "How about another joke, Murray?"],
  [633, 159, 105.2, "MURRAY FRANKLIN"],
  [633, 419, 35.2, "JOKER"],
  [645, 108, 196.2, "No, I think we've had enough"],
  [645, 333, 168.2, "What do you get when you"],
  [657, 108, 105.2, "of your jokes--"],
  [657, 333, 182.2, "cross a mentally-ill loner"],
  [669, 333, 189.2, "with a system that abandons"],
  [681, 333, 161.2, "him and treats him like"],
  [693, 333, 42.2, "trash?"],
];

export const jokerDualDialogueTextContent = {
  items: runs.map(([baseline, x, width, str]) => ({
    str,
    width,
    transform: [12, 0, 0, 12, x, 792 - baseline],
  })),
};

export const jokerDualDialogueViewport = {
  width: 612,
  height: 792,
  scale: 1,
  convertToViewportPoint: (x, y) => [x, 792 - y],
};

export const jokerDualDialoguePage = buildPageTextLines(
  jokerDualDialogueTextContent,
  jokerDualDialogueViewport,
  97
);
