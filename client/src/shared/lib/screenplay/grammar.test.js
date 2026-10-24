import { describe, expect, it } from "vitest";
import {
  getScreenplaySceneHeading,
  parseScreenplayMarkdown,
  screenplayToPlainText,
  serializeScreenplayMarkdown,
} from "./grammar.js";

// Canonical screenplay markdown reads into these elements, and writing the
// elements back gives the same markdown byte for byte.
function expectRoundTrip(markdown, elements) {
  expect(parseScreenplayMarkdown(markdown)).toEqual(elements);
  expect(serializeScreenplayMarkdown(elements)).toBe(markdown);
}

describe("action-only text", () => {
  it("reads each paragraph as one action element", () => {
    expectRoundTrip("Arthur sits alone on the bus.\n\nHe stares out the window.", [
      { type: "action", text: "Arthur sits alone on the bus." },
      { type: "action", text: "He stares out the window." },
    ]);
  });

  it("keeps scene-shaped lines as action instead of guessing headings, cues or transitions", () => {
    const markdown = "INT. BUS - NIGHT\n\nARTHUR\nHello there.\n\nCUT TO:";

    expectRoundTrip(markdown, [
      { type: "action", text: "INT. BUS - NIGHT" },
      { type: "action", text: "ARTHUR\nHello there." },
      { type: "action", text: "CUT TO:" },
    ]);
    expect(getScreenplaySceneHeading(markdown)).toBe("");
    expect(screenplayToPlainText(markdown)).toBe(markdown);
  });

  it("leaves marker characters that don't start a line unescaped", () => {
    expectRoundTrip("Booth #1 is empty, and 3 > 2 & 1 < 2.", [
      { type: "action", text: "Booth #1 is empty, and 3 > 2 & 1 < 2." },
    ]);
  });

  it("reads Windows line endings and blank input", () => {
    expect(parseScreenplayMarkdown("Rain.\r\nThunder.\r\n\r\nA bell.")).toEqual([
      { type: "action", text: "Rain.\nThunder." },
      { type: "action", text: "A bell." },
    ]);
    expect(parseScreenplayMarkdown("")).toEqual([]);
    expect(parseScreenplayMarkdown(null)).toEqual([]);
    expect(serializeScreenplayMarkdown([])).toBe("");
  });
});

describe("wrapped paragraphs", () => {
  it("keeps the line breaks of a wrapped action paragraph, including a hyphen at a break", () => {
    expectRoundTrip("Rain hammers the diner\nwindow, streaking the grease-\npaint sign.", [
      { type: "action", text: "Rain hammers the diner\nwindow, streaking the grease-\npaint sign." },
    ]);
  });

  it("wraps the same way after a scene heading", () => {
    expectRoundTrip("## INT. DINER - NIGHT\n\nRain hammers the diner\nwindow.", [
      { type: "heading", text: "INT. DINER - NIGHT" },
      { type: "action", text: "Rain hammers the diner\nwindow." },
    ]);
  });

  it("keeps a wrapped dialogue paragraph in one quote block", () => {
    expectRoundTrip("### MAYA\n\n> Coffee is all\n> I can do.", [
      { type: "character", text: "MAYA" },
      { type: "dialogue", text: "Coffee is all\nI can do." },
    ]);
  });

  it("writes headings, cues, shots and transitions on one line", () => {
    const markdown = serializeScreenplayMarkdown([
      { type: "heading", text: "INT. DINER\n- NIGHT" },
      { type: "character", text: "MAYA\n(V.O.)" },
      { type: "shot", text: "CLOSE ON\nTHE BELL" },
      { type: "transition", text: "FADE\nOUT." },
    ]);

    expect(markdown).toBe(
      '## INT. DINER - NIGHT\n\n### MAYA (V.O.)\n\n#### CLOSE ON THE BELL\n\n<p align="right">FADE OUT.</p>'
    );
    expect(parseScreenplayMarkdown(markdown)).toEqual([
      { type: "heading", text: "INT. DINER - NIGHT" },
      { type: "character", text: "MAYA (V.O.)" },
      { type: "shot", text: "CLOSE ON THE BELL" },
      { type: "transition", text: "FADE OUT." },
    ]);
  });
});

describe("screenplay elements", () => {
  it("round-trips headings, action, cues, shots, transitions and centered text", () => {
    expectRoundTrip(
      [
        "## INT. DINER - NIGHT",
        "Rain hammers the window.",
        "### MAYA (V.O.)",
        "> It's late.",
        "#### CLOSE ON THE BELL",
        '<p align="right">CUT TO:</p>',
        '<p align="center">THE END<br>A &amp; B &lt;3</p>',
      ].join("\n\n"),
      [
        { type: "heading", text: "INT. DINER - NIGHT" },
        { type: "action", text: "Rain hammers the window." },
        { type: "character", text: "MAYA (V.O.)" },
        { type: "dialogue", text: "It's late." },
        { type: "shot", text: "CLOSE ON THE BELL" },
        { type: "transition", text: "CUT TO:" },
        { type: "centered", text: "THE END\nA & B <3" },
      ]
    );
  });

  it("round-trips a speech whose dialogue and parentheticals share one quote block", () => {
    expectRoundTrip("### SOCIAL WORKER\n\n> > (quietly)\n>\n> It's certainly tense.\n>\n> > (then)\n>\n> How 'bout you.", [
      { type: "character", text: "SOCIAL WORKER" },
      { type: "parenthetical", text: "(quietly)" },
      { type: "dialogue", text: "It's certainly tense." },
      { type: "parenthetical", text: "(then)" },
      { type: "dialogue", text: "How 'bout you." },
    ]);
  });

  it("starts a new quote block for each speech", () => {
    expectRoundTrip("### MAYA\n\n> Coffee?\n\n### ARTHUR\n\n> > (beat)\n>\n> Please.", [
      { type: "character", text: "MAYA" },
      { type: "dialogue", text: "Coffee?" },
      { type: "character", text: "ARTHUR" },
      { type: "parenthetical", text: "(beat)" },
      { type: "dialogue", text: "Please." },
    ]);
  });

  it("writes an unknown element type as action and skips blank elements", () => {
    expect(
      serializeScreenplayMarkdown([
        { type: "montage", text: "A bell rings." },
        { type: "heading", text: "   " },
        { type: "dialogue", text: "" },
      ])
    ).toBe("A bell rings.");
  });
});

describe("escaped marker characters", () => {
  const elements = [
    {
      type: "action",
      text: '# 1 is painted on the door.\n> marks the exit.\n<p align="right">is carved in the booth.</p>',
    },
    { type: "action", text: "The sign reads:\n## OPEN ALL NIGHT" },
  ];
  const markdown =
    '\\# 1 is painted on the door.\n\\> marks the exit.\n\\<p align="right">is carved in the booth.</p>' +
    "\n\nThe sign reads:\n\\## OPEN ALL NIGHT";

  it("escapes action lines that would otherwise start a heading, quote or aligned block", () => {
    expectRoundTrip(markdown, elements);
  });

  it("drops the escapes from plain text", () => {
    expect(screenplayToPlainText(markdown)).toBe(
      '# 1 is painted on the door.\n> marks the exit.\n<p align="right">is carved in the booth.</p>' +
        "\n\nThe sign reads:\n## OPEN ALL NIGHT"
    );
  });
});

describe("screenplayToPlainText", () => {
  const markdown = [
    "## INT. DINER - NIGHT",
    "Rain hammers the diner\nwindow.",
    "### MAYA",
    "> > (quietly)\n>\n> Coffee?",
    '<p align="right">CUT TO:</p>',
  ].join("\n\n");

  it("gives one paragraph per element in reading order, without markers", () => {
    expect(screenplayToPlainText(markdown)).toBe(
      "INT. DINER - NIGHT\n\nRain hammers the diner\nwindow.\n\nMAYA\n\n(quietly)\n\nCoffee?\n\nCUT TO:"
    );
  });

  it("reads parsed elements the same as markdown", () => {
    expect(screenplayToPlainText(parseScreenplayMarkdown(markdown))).toBe(screenplayToPlainText(markdown));
  });
});

describe("simultaneous dialogue", () => {
  const columns = [
    [
      { type: "character", text: "MURRAY FRANKLIN" },
      { type: "dialogue", text: "No, I think we've had enough of your jokes--" },
    ],
    [
      { type: "character", text: "JOKER" },
      { type: "parenthetical", text: "(overlapping)" },
      { type: "dialogue", text: "What do you get when you cross a mentally-ill loner\nwith a system that abandons him?" },
    ],
  ];
  const dual = { type: "dualDialogue", columns };
  const markdown = [
    "::: dual-dialogue",
    "### MURRAY FRANKLIN",
    "",
    "> No, I think we've had enough of your jokes--",
    "::: column",
    "### JOKER",
    "",
    "> > (overlapping)",
    ">",
    "> What do you get when you cross a mentally-ill loner",
    "> with a system that abandons him?",
    ":::",
  ].join("\n");

  it("round-trips both speeches, including parentheticals and unequal line counts", () => {
    expectRoundTrip(markdown, [dual]);
  });

  it("keeps surrounding speeches outside the simultaneous group", () => {
    expectRoundTrip(`### JOKER\n\n> How about another joke, Murray?\n\n${markdown}\n\nThe audience gasps.`, [
      { type: "character", text: "JOKER" },
      { type: "dialogue", text: "How about another joke, Murray?" },
      dual,
      { type: "action", text: "The audience gasps." },
    ]);
  });

  it("exports every word in left-column then right-column reading order", () => {
    const expected = columns.flat().map((element) => element.text).join("\n\n");
    expect(screenplayToPlainText(markdown)).toBe(expected);
    expect(screenplayToPlainText([dual])).toBe(expected);
  });

  it("supports partial captures without character cues", () => {
    expectRoundTrip("::: dual-dialogue\n> enough of your jokes--\n::: column\n> cross a mentally-ill loner\n:::", [
      { type: "dualDialogue", columns: [
        [{ type: "dialogue", text: "enough of your jokes--" }],
        [{ type: "dialogue", text: "cross a mentally-ill loner" }],
      ] },
    ]);
  });

  it("preserves empty columns while an excerpt is being edited", () => {
    for (const emptyColumns of [[[], []], [[], columns[1]], [columns[0], []]]) {
      const element = { type: "dualDialogue", columns: emptyColumns };
      expect(parseScreenplayMarkdown(serializeScreenplayMarkdown([element]))).toEqual([element]);
    }
  });

  it.each([
    "::: dual-dialogue\n### MAYA\n\n> Wait!\n::: column\n> Go!",
    "::: dual-dialogue\n> Wait!\n:::",
    "::: dual-dialogue\n> Wait!\n::: column\n> Go!\n::: column\n> Stop!\n:::",
    "::: dual-dialogue\nAn action paragraph.\n::: column\n> Go!\n:::",
    "::: dual-dialogue\n::: dual-dialogue\n> Wait!\n::: column\n> Go!\n:::\n::: column\n> Stop!\n:::",
  ])("retains malformed group source as ordinary text: %s", (source) => {
    expect(parseScreenplayMarkdown(source)).toEqual([{ type: "action", text: source }]);
    expect(screenplayToPlainText(source)).toBe(source);
    expect(screenplayToPlainText(serializeScreenplayMarkdown(parseScreenplayMarkdown(source)))).toBe(source);
  });

  it("escapes literal fence markers in action text", () => {
    const action = { type: "action", text: "The sign says:\n::: dual-dialogue\n::: column\n:::" };
    expectRoundTrip("The sign says:\n\\::: dual-dialogue\n\\::: column\n\\:::", [action]);
  });
});
