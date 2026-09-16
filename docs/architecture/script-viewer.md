# Script viewer architecture

The script viewer is the page where admins capture scenes from a film's script and visitors read those scenes in context. Terms in this document—captured scene, script location, scene anchor, scene draft, captured text, scene text, raw text, text origin, stale text, re-capture, AI proposal, and film timing—are defined in [`CONTEXT.md`](../../CONTEXT.md).

This document describes the canonical captured-scene contract accepted in [ADR 0001](../adr/0001-canonical-captured-scene-storage.md). The viewer has no compatibility path for saved scenes without anchors, old geometry, inferred locations, stored page ranges, text offsets, or surrounding context.

## Invariants

- Every stored captured scene has one complete, ordered `script_location` with a start and end anchor.
- A scene draft may have zero or one anchor while it is being edited, but it cannot be saved until both anchors resolve to indexed script lines and yield non-blank captured text.
- The saved `scene_text` is the screenplay text visible in the draft. The saved `raw_text` is always the plain text captured from the draft's current anchors.
- Clearing all anchors makes the draft unsaveable. Undo may restore the pair; the saved scene's old location is never silently reused.
- Film timing and script location may touch but not overlap another scene of the same script. The client refuses before sending; the server remains the invariant owner.
- The draft preview and stored scenes share the same presentation shape. There is no preview adapter with old field names.

## Canonical save

`useSceneDraft` returns `draftActions.buildSave({ runtimeSeconds, scenes })`. Its successful result has one payload:

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

Nothing else is sent. In particular, the viewer does not send page ranges, geometry arrays, selected/formatted text aliases, offsets, or context snippets.

The checks run in this order:

1. Film timing parses, is non-negative, is ordered, and does not exceed a known runtime.
2. Film timing does not overlap another captured scene, excluding the scene being edited.
3. Both scene anchors form a contract-valid location: integer page `1…100000`, integer line `0…100000`, finite top and bottom, string text, and start at or before end.
4. Every page in the anchored range has been indexed, both anchors resolve to script lines, and the capture produces non-blank raw text.
5. Scene text is non-blank.
6. Script location does not share a line with another captured scene, excluding the scene being edited.

The successful result also carries `confirmStaleText`. The page asks for confirmation when the visible scene text came from a different anchor pair; accepting the prompt saves that text with the current location and current raw text.

## The scene draft module

`model/sceneDraft.js` is the deep module for the editor workflow. Its interface is the stable pair returned by `useSceneDraft(textIndex)`:

```js
const [draft, draftActions] = useSceneDraft(textIndex);
```

The interface hides reducer transitions, capture derivation, editor source keys, proposal tokens, request reconciliation, and stale-text provenance. The page does not reproduce those rules.

### Draft view

| Field | Meaning |
|---|---|
| `savedScene` | The current stored baseline, or `null` for a new draft. |
| `anchors` | `{ start, end }`; either may be `null` only while editing. |
| `canUndoAnchors` | Whether one of the last 50 anchor states can be restored. |
| `startTime`, `endTime` | Typed film timing fields. |
| `tags` | Ordered selected taxonomy values. |
| `text` | Current scene text, derived from capture while origin is Captured. |
| `textOrigin` | `capture`, `edited`, `ai`, or `saved`. |
| `textStale` | Whether current text belongs to a different anchor pair. |
| `capturedPlainText` | Current raw capture only when it matches the text's pair; otherwise empty for the editor's fidelity baseline. |
| `recaptureOption` | `none`, `recapture`, or `revert`. |
| `editorKey` | Changes only when the editor must replace its block model. |
| `proposal` | Public loading, ready, or error state; the token and provenance stay private. |
| `previewScene` | `{ start_time_seconds, end_time_seconds, script_location, tags, scene_text }`; `script_location` is `null` while incomplete. |
| `dirty` | Whether the draft differs from its saved baseline. |

### Draft actions

| Action | Responsibility |
|---|---|
| `loadScene`, `reset` | Start a new generation so older save responses cannot replace it. |
| `setAnchorAtLine`, `removeAnchor`, `clearAnchors`, `undoAnchors` | Maintain the ordered pair and bounded undo history. |
| `setTime`, `normalizeTime`, `toggleTag`, `clearTags` | Own form state transitions. |
| `editText`, `recapture` | Preserve text provenance and editor identity. |
| `startProposal`, `proposalReady`, `proposalFailed`, `acceptProposal`, `discardProposal` | Own proposal tokens and anchor-pair provenance. |
| `buildSave` | Validate and return the canonical payload plus an `applySaved` completion callback. |
| `prepareDelete` | Snapshot the draft and return the callback to run only after deletion succeeds. |

Actions read the latest committed view through a ref assigned in a layout effect. An event never observes an abandoned concurrent render, and several actions in one event see one committed snapshot.

## Anchors, indexing, and capture

### Text indexing

`useScriptTextIndex` indexes PDF pages in the background and publishes immutable snapshots:

```js
{
  doc,
  pages: Map<pageNumber, positionedPage>,
  complete,
  actionMargin,
}
```

Each positioned line contains its page-local index, bounds, assembled text, and pdf.js items. The index has no document-wide character offsets. A capture depends only on the pages between its anchors, so it can become available before the whole script finishes indexing.

### Capture

`captureAnchoredRange(textIndex, anchors)` is the capture seam. It first applies the same strict location predicate used by page labels, scrolling, overlap checks, and saving. It then:

1. requires every page in the range;
2. resolves the start and end anchor against current line geometry;
3. slices the positioned lines inclusively;
4. classifies screenplay layout using the current action margin;
5. returns `{ key, markdown, plainText, pageStart, pageEnd }`.

The page numbers in the capture are transient conveniences for the AI request. They are not persisted.

Publishing more indexed pages may change the estimated action margin and therefore reclassify an unchanged range. Captured text then changes and receives a new editor key. If a publication leaves the capture unchanged, the editor instance, focus, and caret stay in place. Edited, AI, and saved text do not get overwritten by background indexing.

### Anchor presentation

`model/anchors.js` owns draft-only placement, automatic start/end swapping, stable pair keys, current-line resolution, and saved-scene margin segments. Every stored scene has exact anchors, so margin segments always use their top and bottom geometry; there are no page-wide approximation bars.

## Text provenance and re-capture

Text origins behave as follows:

- **Captured:** the visible text follows the current capture. Moving anchors replaces it automatically.
- **Edited:** typing freezes the visible scene text and remembers the anchor pair it came from.
- **AI formatted:** accepting a proposal freezes its markdown and keys it to the selection used for that proposal.
- **Saved:** loading a scene uses its `scene_text` and keys it to its stored location.

Frozen text is stale only when a capture exists under a different pair key. Moving anchors back clears staleness without changing text. Re-capture replaces stale or edited text with current captured markdown; the page confirms first when hand edits or accepted AI text would be lost.

The editor key separates text provenance from UI lifetime. The first manual edit preserves the captured editor key, so typing does not remount the editor. Re-capture, scene loading, reset, proposal acceptance, or a changed captured source intentionally replaces it. `ScreenplayEditor` transfers focus to the corresponding replacement block and clamps the caret to the new value.

## AI proposals

`startProposal()` returns request data without changing scene text:

```js
{
  token,
  capturedText,
  draftMarkdown,
  pageStart,
  pageEnd,
  snapshotAnchors,
}
```

When a capture exists, the request uses its raw text, page range, and anchor snapshot for PDF images. A saved scene whose pages are not indexed can still propose from its stored text and stored anchor pages, without snapshots. The private proposal stores the requested pair key and captured baseline. A late result is accepted only when its token is current; accepting it does not pretend the anchors stayed put while the request ran.

## Request reconciliation

`model/sceneCollection.js` owns list loading, canonical sorting, save/delete request state, and list replacement. It calls the draft's completion callbacks only after the API operation succeeds.

The draft uses snapshots and generations:

- An unchanged save reloads the returned API scene as the new baseline.
- Edits made while saving stay visible. The returned scene is acknowledged as `savedScene`, so a successful create becomes an update on the next save.
- Loading or resetting while saving changes the generation; the older response is ignored by the draft.
- Deleting an unchanged open scene resets the draft.
- Changes made while deleting survive as a new unsaved draft after the row disappears.
- A delete completing after another scene was opened leaves that scene alone.

This seam gives request-race behavior locality: the page reports notices, while the draft and collection decide state.

## Page composition

`ui/ScriptViewerPage.jsx` composes modules and owns cross-module coordination:

- route parameters, movie/script loading, admin versus visitor mode;
- the PDF document, text index, page windowing, and scroll execution;
- the active annotator tab, anchor menu, dialogs, and transient notices;
- AI request transport and snapshot rendering;
- confirmation prompts and calls into the collection.

It does not own draft transitions or list mutation.

| Module | Owns |
|---|---|
| `model/sceneDraft.js` | Draft state, canonical save validation, text provenance, proposals, and persistence reconciliation. |
| `model/sceneCollection.js` | Captured-scene list and requests. |
| `model/anchors.js` | Draft anchor mechanics and exact saved-scene margin segments. |
| `model/captureRange.js` | Anchored PDF text capture and screenplay classification. |
| `model/useScriptTextIndex.js` | Incremental positioned-page index. |
| `model/usePdfPageWindowing.js` | Responsive page window and scroll mechanics. |
| `ui/AnnotatorPanel.jsx` | Draft controls and presentation. |
| `ui/DraftEditorModal.jsx` | Expanded editor and proposal review. |
| `ui/PdfPageFrame.jsx` | One PDF page and its overlays. |

## Shared captured-scene modules

`entities/script-scene/model/scriptLocation.js` is the shared script-location module:

- `isValidScriptLocation` is the client-side shape and bounds rule;
- `scenePageRange` derives pages from the pair;
- `formatScenePages` labels the derived range;
- `sceneScrollTarget` always targets the start anchor;
- `findOverlappingScriptLocation` applies the inclusive line rule and excludes the draft's own row.

Stored rows are canonical, so the overlap implementation does not filter unsupported stored shapes. Only an incomplete or invalid unsaved location produces no comparison.

`entities/script-scene/model/capturedScene.js` reads `scene_text`, sorts by start page, start line, then id to mirror the server, and builds script links from the derived start page.

## Data map

| Concept | Draft | HTTP / stored scene |
|---|---|---|
| Film timing | `startTime`, `endTime` strings | `start_time_seconds`, `end_time_seconds` integers |
| Script location | `anchors` | `script_location.start`, `script_location.end` |
| Scene text | `text` | `scene_text` |
| Raw text | current capture's `plainText` | `raw_text` |
| Text origin | `textOrigin` | not persisted |
| Stale text | `textStale`, derived from pair keys | not persisted |
| Tags | `tags` | `tags` |
| AI proposal | private token/provenance plus public status | never persisted until accepted as scene text |

## Regression coverage

- `entities/script-scene/model/scriptLocation.test.js` pins page derivation, scrolling, strict bounds, inclusive overlap, adjacency, cross-page ranges, containment, one-line scenes, and own-row exclusion.
- `entities/script-scene/model/capturedScene.test.js` pins canonical text, ordering, and links.
- `model/sceneDraft.test.jsx` tests the draft interface: exact payload keys, incomplete and malformed locations, indexing, undo, editor identity, stale Saved/Edited/AI text, proposals, save/delete races, previews, and overlap refusal.
- `model/sceneCollection.test.js` tests ordered loading and save/delete request reconciliation.
- `ui/ScriptViewerPage.test.jsx` exercises the composed page through real draft, capture, panel, and editor modules. Its named save/reload test is **“saves the exact canonical payload, applies the API-shaped response, and reopens the scene intact.”** It also pins clearing/undo, incremental indexing, stale confirmation, AI acceptance, focus/caret handoff, request races, canonical scrolling, and exact margin segments.

The page suite doubles only external seams: HTTP operation modules, session state, `react-pdf`, the background index store, page windowing, page-frame rendering, AI page snapshots, and `window.confirm`.
