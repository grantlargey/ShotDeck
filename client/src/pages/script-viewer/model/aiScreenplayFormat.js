import { formatScreenplaySelection } from "@/shared/api/screenplayFormat.js";
import { renderSelectionSnapshots } from "../lib/pageSnapshots.js";

/**
 * The screenplay markdown the AI formatter proposes for a scene draft.
 *
 * Takes the request a scene draft's `startProposal()` returned and gives back
 * the proposed markdown; the caller decides what to do with it, and nothing
 * here touches the draft. Rendering the pages the selection covers, cropping
 * them to it, and the shape of the formatter's request and reply all stay
 * inside.
 *
 * A draft with no captured range sends its text alone: there are no pages to
 * photograph. An empty reply comes back as an empty string, which the caller
 * treats as a proposal that changed nothing.
 */
export async function requestScreenplayProposal(request, { pdfDocument, indexedPages }) {
  const snapshots =
    request.snapshotAnchors && pdfDocument
      ? await renderSelectionSnapshots(pdfDocument, request.snapshotAnchors, indexedPages)
      : { pageImages: [], omittedPageCount: 0 };

  const { capturedText, draftMarkdown, pageStart, pageEnd } = request;
  const result = await formatScreenplaySelection({
    capturedText,
    draftMarkdown,
    pageStart,
    pageEnd,
    ...snapshots,
  });
  return result?.markdown || "";
}
