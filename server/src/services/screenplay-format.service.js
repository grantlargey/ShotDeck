import { HttpError } from "../utils/http-error.js";

/*
 * AI formatting for captured screenplay selections.
 *
 * The client captures text deterministically from the PDF text layer and
 * builds a layout-based draft. This service is only called when the user asks
 * for a proposal, and the client shows the proposal for approval before it
 * replaces anything. The grammar mirrors
 * client/src/shared/lib/screenplay/grammar.js; keep them in sync.
 */

const EXAMPLE = `<p align="right">FADE IN:</p>

## INT. DEPT. OF HEALTH, OFFICE - MORNING

She just sits behind her desk, waiting for his laughing fit to end, she's been through this before. Finally it subsides.

### JOKER

> --is it just me, or is it getting crazier out there?

### SOCIAL WORKER

> It's certainly tense. People are upset, they're struggling.
>
> > (then)
>
> How 'bout you. How's the job? Still enjoying it?

<p align="right">CUT TO BLACK:</p>`;

const SYSTEM_PROMPT = [
    "You convert screenplay excerpts into ScriptDeck screenplay markdown, so that reading the markdown feels like reading the script page.",
    "",
    "RULES",
    "1. Preserve every word of the script body exactly: same spelling, capitalization, and punctuation. Never summarize, paraphrase, correct, complete, or invent text.",
    '2. Leave out anything that is not the body of the script: scene numbers, page numbers, revision asterisks, running headers and footers, "(MORE)", and the "(CONT\'D)" cue that repeats a speaker after a page break. Merge a speech that continues across a page break into one dialogue block.',
    "3. Cover exactly the CAPTURED TEXT, from its first line to its last. Page images can show text outside the selection; ignore that text.",
    "4. Return only the markdown, with no code fences and no commentary.",
    "",
    "GRAMMAR (one screenplay element per block, blocks separated by one blank line)",
    "- Scene heading: ## INT. LOCATION - TIME",
    '- Action: a plain paragraph. Join the PDF\'s wrapped lines with single spaces, and re-join words hyphenated across a line break ("grease-" + "paint" becomes "grease-paint").',
    "- Character cue: ### NAME, keeping extensions such as (V.O.), (O.S.), (PRE-LAP).",
    '- Dialogue: the speech under a cue, written as a quote block ("> text"), with wrapped lines joined into one paragraph.',
    '- Parenthetical: inside the speech\'s quote block as "> > (text)", separated from neighboring dialogue paragraphs by a line containing only ">".',
    "- Shot: #### CLOSE ON JOKER, only for a camera direction set on its own line.",
    '- Transition: <p align="right">CUT TO:</p> for right-aligned transitions such as FADE IN:, CUT TO:, SMASH CUT TO:.',
    '- Centered text (titles, THE END): <p align="center">TEXT</p>',
    "",
    "Element type follows the page layout: scene headings, action, and shots start at the left margin; dialogue is indented about 1 inch, parentheticals about 1.5 inches, and character cues about 2 inches; transitions sit at the right edge.",
    "",
    "EXAMPLE",
    EXAMPLE,
].join("\n");

function extractResponseOutputText(payload) {
    if (!payload || typeof payload !== "object") return "";

    const parts = [];
    for (const block of Array.isArray(payload.output) ? payload.output : []) {
        for (const item of Array.isArray(block?.content) ? block.content : []) {
            if (item?.type === "output_text" && typeof item.text === "string") parts.push(item.text);
        }
    }
    return parts.join("\n");
}

function stripCodeFences(text) {
    return text
        .replace(/^\s*```(?:markdown|md)?[ \t]*\n/i, "")
        .replace(/\n```\s*$/, "")
        .trim();
}

function buildUserContent({ capturedText, draftMarkdown, pageStart, pageEnd, pageImages, omittedPageCount }) {
    const pageRange = pageStart && pageEnd && pageEnd !== pageStart ? `pages ${pageStart}-${pageEnd}` : `page ${pageStart || pageEnd || "unknown"}`;
    const imageNote = pageImages.length
        ? `${pageImages.length} page image(s) follow, cropped to the selection.${omittedPageCount ? ` ${omittedPageCount} middle page(s) were not imaged.` : ""}`
        : "No page images were provided.";

    const content = [
        {
            type: "input_text",
            text: [
                "CAPTURED TEXT (exact words from the PDF text layer, in reading order; the authority for wording):",
                "<<<",
                capturedText,
                ">>>",
                "",
                "DRAFT MARKDOWN (automatic layout-based conversion; element types or paragraph breaks may be wrong):",
                "<<<",
                draftMarkdown || "(none)",
                ">>>",
                "",
                `The selection spans ${pageRange}. ${imageNote}`,
            ].join("\n"),
        },
    ];

    for (const image of pageImages) {
        content.push({ type: "input_text", text: `Page ${image.page}:` });
        content.push({ type: "input_image", image_url: image.dataUrl, detail: "high" });
    }
    return content;
}

export async function formatScreenplaySelection(input) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error("Screenplay formatting is disabled: OPENAI_API_KEY is not set.");
        throw new HttpError(503, "AI formatting isn't available right now.");
    }

    const model = process.env.OPENAI_SCREENPLAY_MODEL || "gpt-5-nano";
    const timeoutMs = Number(process.env.OPENAI_SCREENPLAY_TIMEOUT_MS || 90000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                input: [
                    { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
                    { role: "user", content: buildUserContent(input) },
                ],
                // Reasoning models reject temperature; older chat models benefit from 0.
                ...(model.startsWith("gpt-4") ? { temperature: 0 } : {}),
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            console.error(`Screenplay formatter request failed (${response.status}): ${body}`);
            throw new HttpError(502, "The AI formatter request failed. Try again, or keep the captured text.");
        }

        const markdown = stripCodeFences(extractResponseOutputText(await response.json()));
        if (!markdown) throw new HttpError(502, "The AI formatter returned no text.");

        return { markdown, model };
    } catch (err) {
        if (err?.name === "AbortError") {
            throw new HttpError(504, "The AI formatter timed out. Try a shorter selection.");
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}
