/**
 * The descriptions the scene search types out as examples, in Script Search's
 * tile and the home page's hero. They're a fixed set: nothing on the page
 * (filters, results, the film) changes which show.
 */
export const SEARCH_EXAMPLES = [
  "Accidental gunshot",
  "Burning the midnight oil",
  "Betrayed by a coworker",
  "Isolated commute / transit absurdism",
  "Processing a career setback",
  "Presentation gone wrong",
  "Undue cruelty / Senseless violence",
  "Reprimanded by an authority",
  "Systemic shortcomings and social unrest",
  "Unleashing frustrations physically",
  "Suppressed exasperation",
  "mental health crisis",
  "Upsetting phone call",
  "Overconfidence leading to an absolute flop",
  "Fleeing the scene of the crime",
  "Petty theft",
  "Something inside them just snaps",
  "Uncontrollable laughter",
  "Confiding in someone / venting",
  "Basking in the attention of a love interest",
  "Obsessive ritual",
  "Late-night loneliness",
  "Skidding to a stop",
  "On the wrong end of scarcity",
  "Excluded from the group dynamic",
  "On the outside looking in",
  "A moment of self-reflection",
  "Mental deterioration / Gradually unraveling",
  "Off the meds",
  "Momentum fueled by sheer panic",
  "Throwing a fit",
  "Sudden and unexpected unemployment",
  "Bunch of yuppies",
  "Most people wouldn't do that in a mirror...",
];

/**
 * Deals examples in a random order, every one before any repeats. Each round
 * is shuffled afresh and never starts with the example that ended the last,
 * so no example shows twice in a row.
 */
export function createExampleDeck(examples, random = Math.random) {
  let order = [];
  let last = null;

  function shuffle() {
    const next = [...examples];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    if (next.length > 1 && next[0] === last) {
      const swap = 1 + Math.floor(random() * (next.length - 1));
      [next[0], next[swap]] = [next[swap], next[0]];
    }
    return next;
  }

  return {
    /** The next example, or "" when there are none. */
    next() {
      if (examples.length === 0) return "";
      if (order.length === 0) order = shuffle();
      last = order.shift();
      return last;
    },
  };
}
