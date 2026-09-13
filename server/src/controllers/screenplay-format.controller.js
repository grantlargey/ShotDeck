import { formatScreenplaySelection } from "../services/screenplay-format.service.js";
import { isHttpError } from "../utils/http-error.js";

const MAX_TEXT_LENGTH = 60000;
const MAX_PAGE_IMAGES = 6;
const MAX_IMAGE_DATA_URL_LENGTH = 3_000_000;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function optionalPage(value) {
    return Number.isInteger(value) && value > 0 ? value : null;
}

function parseBody(body) {
    const { capturedText, draftMarkdown, pageStart, pageEnd, pageImages, omittedPageCount } = body || {};

    if (typeof capturedText !== "string" || !capturedText.trim()) {
        return { error: "Invalid body. Expected capturedText to be a non-empty string." };
    }
    if (capturedText.length > MAX_TEXT_LENGTH || (typeof draftMarkdown === "string" && draftMarkdown.length > MAX_TEXT_LENGTH)) {
        return { error: "The selection is too long to format. Capture a shorter range." };
    }

    const images = Array.isArray(pageImages) ? pageImages : [];
    if (images.length > MAX_PAGE_IMAGES) {
        return { error: `At most ${MAX_PAGE_IMAGES} page images can be sent.` };
    }
    for (const image of images) {
        if (
            !Number.isInteger(image?.page) ||
            typeof image?.dataUrl !== "string" ||
            image.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH ||
            !IMAGE_DATA_URL.test(image.dataUrl)
        ) {
            return { error: "Invalid page image. Expected { page:int, dataUrl:base64 image }." };
        }
    }

    return {
        input: {
            capturedText,
            draftMarkdown: typeof draftMarkdown === "string" ? draftMarkdown : "",
            pageStart: optionalPage(pageStart),
            pageEnd: optionalPage(pageEnd),
            pageImages: images.map((image) => ({ page: image.page, dataUrl: image.dataUrl })),
            omittedPageCount: Number.isInteger(omittedPageCount) && omittedPageCount > 0 ? omittedPageCount : 0,
        },
    };
}

export async function formatScreenplay(req, res) {
    const { error, input } = parseBody(req.body);
    if (error) return res.status(400).json({ error });

    try {
        return res.json(await formatScreenplaySelection(input));
    } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.message });
        console.error("POST /api/script-scenes/format error:", err);
        return res.status(500).json({ error: "Failed to format the selection." });
    }
}
