# Script viewer architecture

The script viewer is where admins capture scenes from a film's script and visitors read those scenes in context. The domain terms used here are defined in [`CONTEXT.md`](../../CONTEXT.md), and the stored-scene decision is recorded in [ADR 0001](../adr/0001-canonical-captured-scene-storage.md).

## Supported captured-scene contract

Every stored captured scene has:

- a complete, ordered script location with a start and end scene anchor;
- film timing that does not overlap another scene of the same script;
- a script location that does not share a line with another scene of the same script;
- non-blank scene text and raw text; and
- tags from the shared taxonomy in `server/src/domain/script-tags.js`.

A scene draft may have incomplete anchors while it is being edited. It cannot be saved until both anchors resolve to indexed script lines and the anchored range produces non-blank raw text. Film timings and script locations may touch another scene at their boundaries, but may not overlap it. The client refuses invalid saves before sending them, and the server and database enforce the stored invariants.

`draftActions.buildSave({ runtimeSeconds, scenes })` returns an error or a result containing this six-field request payload:

```js
{
  start_time_seconds,
  end_time_seconds,
  script_location: {
    start: { page, line, top, bottom, text },
    end: { page, line, top, bottom, text },
  },
  scene_text,
  raw_text,
  tags,
}
```

Validation runs in this order:

1. Parse and validate the film timing against the film runtime.
2. Reject film timing that overlaps another captured scene, excluding the scene being edited.
3. Require a complete, readable capture from the current anchors.
4. Require non-blank scene text.
5. Reject a script location that shares a line with another captured scene, excluding the scene being edited.

The saved `scene_text` is the screenplay text visible in the draft. The saved `raw_text` is the plain text captured from the current anchors. If the visible scene text belongs to a different anchor pair, `buildSave` marks the payload for confirmation before it can be sent.

## Ownership

The page composes a small set of modules with distinct responsibilities:

| Module | Owns |
|---|---|
| `model/sceneDraft.js` | Draft transitions, save validation and payload construction, text provenance, AI proposal state, and save/delete response reconciliation. |
| `model/sceneCollection.js` | Loading, sorting, creating, updating, and deleting the script's captured scenes. |
| `model/anchors.js` | Draft anchor placement and swapping, anchor resolution, stable pair keys, and saved-scene margin segments. |
| `model/captureRange.js` | Capturing an anchored PDF range and classifying it as screenplay text. |
| `model/useScriptTextIndex.js` | The incremental immutable index of positioned PDF text lines. |
| `model/usePdfPageWindowing.js` | Responsive page rendering windows and scroll mechanics. |
| `ui/ScriptViewerPage.jsx` | Route data, page composition, PDF coordination, dialogs, prompts, notices, and AI request transport. |
| `ui/AnnotatorPanel.jsx` | Draft controls and presentation. |
| `ui/DraftEditorModal.jsx` | Expanded scene-text editing and AI proposal review. |
| `ui/PdfPageFrame.jsx` | One PDF page and its anchor and scene overlays. |

`ScriptViewerPage` may coordinate these owners, but it does not reproduce draft transitions or captured-scene list mutation.

## Draft and capture lifecycle

`useSceneDraft(textIndex)` returns a stable pair:

```js
const [draft, draftActions] = useSceneDraft(textIndex);
```

The draft view exposes the saved baseline, anchors and undo availability, typed film timing, tags, visible text and its origin, stale-text state, the editor key, proposal state, preview scene, and dirty state. Its actions own anchor, timing, tag, text, proposal, save, and delete transitions.

Actions read the latest committed view through a ref assigned in a layout effect. Several actions in one event therefore use one committed snapshot, and no action observes a render that React abandoned.

### PDF indexing and capture

`useScriptTextIndex` publishes immutable snapshots with the PDF document, indexed pages, completion state, and estimated action margin. Each positioned line has its page-local index, bounds, assembled text, and pdf.js items.

`captureAnchoredRange(textIndex, anchors)`:

1. applies the shared strict script-location predicate;
2. requires every page in the anchored range;
3. resolves both anchors against current line geometry;
4. slices the positioned lines inclusively;
5. classifies their screenplay layout; and
6. returns the anchor-pair key, screenplay markdown, plain text, and transient page range.

The page range supports the AI request and is not part of stored scene data. A capture can become available before the whole script finishes indexing because it depends only on pages inside its anchor pair.

Publishing more pages can change the estimated action margin and reclassify an unchanged capture. Captured text then receives a new editor key. Publications that leave the capture unchanged preserve the editor, focus, and caret; manually edited, AI-formatted, and saved text are not replaced by background indexing.

### Text origin and re-capture

The draft tracks four text origins:

- **Captured** text follows the current capture and updates when its capture changes.
- **Edited** text is frozen at the anchor pair where editing began.
- **AI formatted** text is frozen at the selection used for its proposal.
- **Saved** text is loaded with the stored script location.

Frozen text is stale when a capture exists for a different anchor pair. Moving the anchors back to the original pair clears staleness without changing the text. Re-capture replaces the visible text with the current captured text; the page confirms first when that would discard edited or AI-formatted text.

`editorKey` separates text provenance from editor lifetime. The first manual edit preserves the current editor. Re-capture, loading or resetting a draft, accepting an AI proposal, or receiving a changed captured source intentionally replaces it, and `ScreenplayEditor` transfers focus and clamps the caret to the replacement value.

### AI proposals

`startProposal()` returns the request token, captured or draft text, current markdown, page range, and anchor snapshot. When a capture exists, the request uses its raw text and anchor snapshot for PDF images. A saved draft can propose from its stored text before its pages have been indexed.

The token and selection provenance remain private to the draft. A result applies only to the current token, and a proposal changes no scene text until the admin accepts it.

## Persistence reconciliation

`useSceneCollection` owns network state and canonical list ordering. It calls the draft's completion callback only after an API operation succeeds.

The draft snapshots each persistence request and reconciles its response against the current generation:

- An unchanged save loads the returned scene as the new baseline.
- Edits made while saving remain visible, while a successful create still attaches its new id for the next save.
- Resetting or loading another scene invalidates an older save response.
- Deleting an unchanged open scene resets the draft.
- Changes made while deleting survive as a new unsaved draft.
- A delete that finishes after another scene opens leaves the new scene untouched.

The page owns success/error notices and confirmation wording; the draft and collection own state decisions.

## Shared captured-scene rules

`entities/script-scene/model/scriptLocation.js` is the single client owner of script-location validity, derived page ranges, page labels, scroll targets, and inclusive line-overlap checks. Stored scenes use complete locations; only an unsaved draft may be incomplete.

`entities/script-scene/model/filmTiming.js` owns parsing, formatting, and film-timing overlap. `entities/script-scene/model/capturedScene.js` owns stored scene text access, tag normalization, server-matching order, and script-viewer links.

The data mapping is:

| Concept | Draft | HTTP and stored scene |
|---|---|---|
| Film timing | `startTime`, `endTime` | `start_time_seconds`, `end_time_seconds` |
| Script location | `anchors` | `script_location.start`, `script_location.end` |
| Scene text | `text` | `scene_text` |
| Raw text | current capture's `plainText` | `raw_text` |
| Text origin and staleness | derived draft state | not persisted |
| Tags | `tags` | `tags` |
| AI proposal | private request provenance plus public status | not persisted until accepted as scene text |

## Where to change behavior

| Change | Primary owner |
|---|---|
| Save fields, validation order, text provenance, re-capture, and persistence callbacks | `model/sceneDraft.js` |
| Capture availability and anchored text extraction | `model/captureRange.js` |
| Film timing parsing, display, and overlap | `entities/script-scene/model/filmTiming.js` |
| Script-location validity, display, scrolling, and overlap | `entities/script-scene/model/scriptLocation.js` |
| Stored scene text, tags, ordering, and links | `entities/script-scene/model/capturedScene.js` |
| Anchor placement, resolution, and margin lanes | `model/anchors.js` |
| PDF line construction and pointer snapping | `shared/lib/pdf-text/pageTextLines.js` |
| Screenplay layout classification | `shared/lib/screenplay/layoutClassifier.js` |
| Captured-scene list requests and replacement | `model/sceneCollection.js` |
| AI request transport, prompts, keyboard anchors, navigation, and notices | `ui/ScriptViewerPage.jsx` |
| Editor replacement, focus, and caret handoff | `draft.editorKey` and `ui/ScreenplayEditor.jsx` |

Keep every consumer on these owners instead of introducing a second rule.

## Verification

From the repository root, run:

```bash
npm run check:unused
npm test --prefix client
npm run lint --prefix client
npm run build --prefix client
npm test --prefix server
npm run lint --prefix server
npm run smoke:browser
```

Unit and composed-page tests exercise the real draft, capture, screenplay classifier, panel, editor, and dialogs while replacing external seams such as HTTP, session state, pdf.js rendering, page snapshots, and browser confirmation. The browser smoke exercises the supported create, reopen, update, overlap-refusal, and delete flow against the real API and a throwaway PostgreSQL database.
