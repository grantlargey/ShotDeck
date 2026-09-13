function extractResponseOutputText(payload) {
    if (!payload || typeof payload !== "object") return "";
    if (typeof payload.output_text === "string") return payload.output_text;

    const blocks = Array.isArray(payload.output) ? payload.output : [];
    const parts = [];

    for (const block of blocks) {
        const content = Array.isArray(block?.content) ? block.content : [];
        for (const item of content) {
            if (item?.type === "output_text" && typeof item.text === "string") {
                parts.push(item.text);
            }
        }
    }

    return parts.join("\n").trim();
}

/**
 * OpenAI-backed cleanup for pasted PDF selections.
 *
 * Failure is intentionally non-fatal: the caller falls back to the original
 * text, preserving the previous UX when the formatter is unavailable.
 */
export async function formatAnnotationText(rawText) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { formattedText: rawText, accepted: false };
    }

    const model = process.env.OPENAI_FORMAT_MODEL || "gpt-5-nano";
    const timeoutMs = Number(process.env.OPENAI_FORMAT_TIMEOUT_MS || 10000);
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
                    {
                        role: "system",
                        content: [
                            {
                                type: "input_text",
                                text:
                                    "You format messy PDF text selections for annotations.\n" +
                                    "preserve original wording\n" +
                                    "do not summarize\n" +
                                    "do not paraphrase\n" +
                                    "do not invent or complete missing text\n" +
                                    "only improve whitespace, spacing, and line breaks\n" +
                                    "remove obvious standalone margin/page/scene number artifacts only when they clearly look like junk tokens\n" +
                                    "Return plain text only.",
                            },
                        ],
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: `RAW TEXT:\n<<<\n${rawText}\n>>>`,
                            },
                        ],
                    },
                ],
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`OpenAI formatter request failed (${response.status}): ${body}`);
        }

        const payload = await response.json();
        const formattedText = extractResponseOutputText(payload);

        if (!formattedText || !formattedText.trim()) {
            return { formattedText: rawText, accepted: false };
        }

        return { formattedText, accepted: true };
    } finally {
        clearTimeout(timeout);
    }
}
