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

## Where to change behavior

| Change | Primary owner | Related seam |
|---|---|---|
| Canonical request fields and validation order | `buildSavePayload` in `model/sceneDraft.js` | `saveScene` in `ui/ScriptViewerPage.jsx` sends the result and owns notices/prompts. |
| Capture-unavailable messages | `captureUnavailableReason` in `model/captureRange.js` | `CAPTURE_UNAVAILABLE_ERRORS` in `model/sceneDraft.js` maps reasons to user text. |
| Film timing validation, display and overlap | `entities/script-scene/model/filmTiming.js` | `buildSavePayload` chooses its place in save validation. |
| Script-location validity, page labels, scrolling and overlap | `entities/script-scene/model/scriptLocation.js` | Keep every consumer on `isValidScriptLocation`; do not grow another validity rule. |
| Stored scene text, order and links | `entities/script-scene/model/capturedScene.js` | Search, cards, scene detail and the viewer all consume it. |
| Anchor placement, swapping, resolution and margin lanes | `model/anchors.js` | `PdfPageFrame` renders the resulting draft markers and stored segments. |
| PDF line construction and pointer snapping | `shared/lib/pdf-text/pageTextLines.js` | `useScriptTextIndex` owns background publication. |
| Screenplay layout classification | `shared/lib/screenplay/layoutClassifier.js` | `captureRange.js` supplies positioned line segments and the estimated action margin. |
| Text origin, stale state, dirty state and re-capture | `useSceneDraft` reducer and derived view | `AnnotatorPanel` and `DraftEditorModal` present, but do not reproduce, those rules. |
| Editor replacement, focus and caret handoff | `editorKey` in `useSceneDraft`; `ScreenplayEditor` in `ui/ScreenplayEditor.jsx` | Index publication is the important race boundary. |
| AI request payload and selection snapshots | `startProposal` in `useSceneDraft`; `requestAiFormat` in `ScriptViewerPage` | `DraftEditorModal` compares the proposal with the request-time baseline. |
| Save/delete response reconciliation | `useSceneDraft` completion callbacks | `model/sceneCollection.js` owns network state and list replacement. |
| Confirmation wording and navigation guards | `ui/ScriptViewerPage.jsx` | The draft exposes `dirty`, `confirmStaleText` and `recaptureReplacesEdits`. |
| Keyboard anchors and undo exclusions | `ui/ScriptViewerPage.jsx` | Inputs, editors, modifier chords and the open anchor menu must keep their keys. |
| Visitor scene selection and Show in script | `ui/ScriptViewerPage.jsx` | `SceneViewerModal` presents the scene; `sceneScrollTarget` supplies the exact target. |
| Test indexes and API rows | `test/textIndexFixtures.js`, `test/pageHarness.js` | These must mirror `useScriptTextIndex` snapshots and the canonical serializer shape. |

## Regression coverage

Run all client checks from the repository root:

```bash
npm test --prefix client -- --run
npm run lint --prefix client
npm run build --prefix client
```

Vitest uses jsdom. The page suite doubles only external seams: HTTP operation modules, session state, `react-pdf`, the background index store, page windowing, page-frame rendering, AI page snapshots, and `window.confirm`. The draft, capture, screenplay classifier, panel, editor and dialogs are real.

### Shared entity and collection rules

- `entities/script-scene/model/scriptLocation.test.js` pins the one strict predicate, page/line caps, malformed and reversed locations, page derivation, scrolling, inclusive overlap, adjacent lines, cross-page containment, one-line scenes and own-row exclusion. Stored rows are canonical fixtures; only draft inputs are invalid.
- `entities/script-scene/model/capturedScene.test.js` pins `scene_text`, start-page/start-line/id ordering and links derived from the start anchor.
- `model/sceneCollection.test.js` pins sorted loading, create/update/delete list reconciliation, busy state, completion callbacks and failures that leave the list unchanged.

### Draft interface

`model/sceneDraft.test.jsx` exercises the hook without duplicating reducer internals:

- **Committed view:** several actions in one React batch read the preceding committed snapshot, and actions never see a render React abandoned. Action, anchor, preview and public proposal identities stay stable while their inputs do.
- **Capture work and indexing:** timing, tags, editing and proposal transitions do not recapture. Anchor or index changes do. Stable publications preserve the editor; layout reclassification replaces untouched Captured text. Edits that commit before or in the same batch as publication survive, as do accepted AI text and a pending proposal's request-time baseline.
- **Location requirements:** incomplete, malformed, out-of-bounds and reversed anchors; unfinished ranges; completed indexes missing a required page; empty anchor pages; and captures reduced to blank raw text all refuse locally. The exact six-field payload test uses a real taxonomy value.
- **Text provenance:** stale Saved, Edited and AI text require confirmation; moving back to the original pair clears it. The re-capture table pins `none`, `revert` and `recapture`, whether edits would be replaced, editor-key revisions, and a 50-entry undo cap.
- **Proposal provenance:** StrictMode token allocation, superseded/discarded/previous-draft responses, anchor changes while pending or ready, clearing anchors, and a canonical saved scene requested before its pages are indexed.
- **Persistence:** unchanged responses establish a baseline; newer edits survive; create responses attach their id; reset/load/reopen generations reject old responses; delete completion clears unchanged work, detaches changed work and invalidates an older pending save. Same-batch cases are explicit.
- **Overlap:** film timing and script-location rules are checked in the documented order, with the draft's own row excluded.

### Composed page behavior

`ui/ScriptViewerPage.test.jsx` is the user-visible matrix:

- **Canonical round trip:** **“saves the exact canonical payload, applies the API-shaped response, and reopens the scene intact”** asserts the six exact keys, distinct scene/raw text, timing, tags and anchors; applies the fake Contract response; starts a new draft; reopens the created row; then updates it with the same payload.
- **Anchors and keys:** clear makes a loaded scene unsaveable; undo restores it. Keyboard placement and undo ignore editor/input focus, modifiers and an open anchor menu.
- **Index/editor races:** unfinished ranges refuse; stable publishes keep focus/caret; reclassification hands them to an untouched replacement; manual edits before and in the same batch as reclassification stay in the same editor. Page-frame handler identity and capture locality are pinned.
- **Text and AI:** re-capture asks before replacing edits; Saved, Edited and AI stale-save paths keep separate confirmations; an edit during a confirmed AI save requires a new decision. AI results remain inert until accepted, keep the request-time baseline across anchor movement, report/dismiss failures, and do nothing when no capture or draft text exists.
- **Persistence races:** a response does not replace a different, reset or left-and-reopened draft. A create response binds newer edits to the new id. Delete completion handles unchanged, changed and different open drafts separately.
- **Overlap and navigation:** film ranges that overlap refuse while touching saves; shared boundary lines refuse while adjacent lines save. Admin and visitor deep links, visitor scene-bar selection, Show in script, exact margin segments, canonical DOM order and API load failure are covered.

### Browser verification history and limitations

The entries below are historical evidence from 2026-09-14. They exercised the same editor state machine before the canonical storage cutover, so their interaction/race findings still matter; their old request-field and storage-shape observations are **not** evidence for the current HTTP contract. The current canonical contract is verified automatically by the named save/response/reopen test above, not by a post-cutover browser run yet.

- Chromium, the real Express routes and serializers, and a disposable PostgreSQL database passed login/session, capture/save, reload/reopen, update and delete with synthetic records. A delayed save response preserved a newer time edit and the next save targeted the same row. PDF delivery alone used a local fixture and all external traffic was blocked.
- The stale-text flow was exercised with object-storage sends forced to fail: a fresh capture saved without a prompt; canceling a moved-anchor prompt sent nothing; confirming stored the retained text with the new location and raw capture; reloading cleared the prompt; and an edit during a confirmed request survived and required another decision. Those semantics remain current, but the historical requests used the pre-canonical field names.
- The indexing/focus flow ran in Chromium 151 against the Vite development app in `StrictMode`, with real pdf.js indexing a synthetic 17-page PDF. A gate injected into the locally served indexer published pages on cue; page 17 moved the estimated action margin. Unrelated publications preserved focus/caret, reclassification replaced untouched text and handed off focus, real keystrokes around a publication survived, and Script/Markdown/reopened views agreed. Markdown mode moved the caret to the end in Chromium. The same-batch boundary was observable only in automated hook/page tests.
- Historical harness files live in the ignored `.scratch/architecture-followups/c3-browser/` directory and use a locally cached Playwright.

Neither the historical browser work nor jsdom verifies object-storage credentials/CORS, real AI output, browser layout and pointer snapping across engines, concurrent database exclusion constraints, the production deployment, or the issue-11/issue-14 integration result. After those branches merge, rerun the full client suite/build and perform one real-browser canonical create/reopen/update/delete smoke check before release.
