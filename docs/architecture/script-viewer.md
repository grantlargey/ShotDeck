# Script viewer

The script viewer is the page where admins capture scenes from a film's script, and where visitors read the script and open its captured scenes. Terms in this document (scene draft, scene anchor, suggested anchors, captured text, scene text, raw text, text origin, stale text, re-capture, AI proposal, script location, legacy scene, film timing) are defined in [`CONTEXT.md`](../../CONTEXT.md).

## What will a scene draft save, and why?

Read one module: `useSceneDraft` in `client/src/pages/script-viewer/model/sceneDraft.js`. It owns the scene draft's state, how that state changes, and `draftActions.buildSave(runtimeSeconds)`, which returns either `{ error }` or `{ payload, applySaved }`. The page sends `payload` to create or update the captured scene, then passes the returned scene to `applySaved`.

**Validation**, in order:

1. Film timing: both times present, `HH:MM:SS` or `MM:SS`, end not before start, and not past the film's runtime when it is known (`getTimingError`).
2. Scene text isn't blank.
3. A script location exists.

The second and third checks share the message "Place start and end anchors in the script to capture the scene text."

**Scene text** (`selected_text` and `formatted_selected_text`, both set to `draft.text`) depends on the text origin:

| Text origin | Where the text comes from |
|---|---|
| `"capture"` | Captured text, read live from the anchors in effect. It changes whenever the anchors or the text index change, and isn't stored in the draft. |
| `"edited"` | Typed in the editor dialog. |
| `"ai"` | An accepted AI proposal. |
| `"saved"` | The saved scene's formatted text, else its raw text, else its selected text. |

Text of any origin other than `"capture"` remembers the anchor pair it belongs to. When a capture exists under a different pair, the text is stale. Stale text is still saved as it is; re-capturing is the admin's choice.

**Script location** (`page_start`, `page_end`, `start_offset`, `end_offset`, `context_prefix`, `context_suffix`, `anchor_geometry`):

- From the current capture, when there is one **and** the draft has explicit anchors. Empty context becomes `null`, and geometry is written as version-2 entries.
- Otherwise from the saved scene, as stored. Missing fields become `null`, and non-array geometry becomes `[]`.
- Otherwise there's no location, and saving is refused.

Offsets stay `null` until the whole script has been indexed. Suggested anchors never become the saved location on their own; an anchor change or a re-capture must first make them explicit.

**Raw text** (`raw_selected_text`) follows the location: the capture's plain text, else the saved scene's raw text, else plain text derived from the scene text.

**Film timing and tags**: times are parsed to seconds, and tags are sent in the order they were selected.

### Responses arriving after the draft changes

`buildSave` captures the draft being saved. Its `applySaved(scene)` callback reconciles the response in the reducer, where it sees all queued changes:

- If the same draft is unchanged, load the returned scene normally.
- If that draft has newer changes, update its saved baseline and keep its current text, timing, tags, anchors, undo history, and editor key. Those newer edits remain unsaved. A newly created scene receives its saved id, so the next save updates it instead of creating a duplicate.
- If the admin loaded or started another draft, leave it alone. Leaving and reopening the same scene also counts as a new draft.

Before a deletion request, call `draftActions.prepareDelete(sceneId)` and retain its completion callback. Call it only after the request succeeds. It clears an unchanged deleted draft, leaves a different scene alone, and preserves newer changes to the deleted scene as a new unsaved draft. A legacy draft without explicit anchors may need a new capture before it can be saved as a new scene. Deletion also invalidates older saves for that draft.

The page still updates the saved-scene collection and shows the request result. Networking stays in the page; whether a response can replace the draft belongs to the draft module. These rules fix the earlier I1/I2 response races.

### AI proposals keep the selection they were requested for

`startProposal()` reads the committed draft and stores the proposal's selection with its token:

- **With a capture:** the capture's anchor key, plus its plain text as the proposal's word-check baseline (`draft.proposal.capturedPlainText`). This applies even when the draft text is stale, because the request sends that capture.
- **Without a capture** (no anchor pair, or pages not yet indexed): the draft text's own anchor key, and `""` as the baseline, which means no word check. The key is empty for a legacy scene or for text typed without a capture. The request still sends plain text derived from the draft text.

Accepting a ready proposal is always explicit and is never refused. The proposal becomes `"ai"` text keyed to the stored selection, and the usual stale-text rule applies:

- **Stale:** a capture exists under a different anchor pair. This happens when the anchors moved while the request was pending or after it was ready, when they were cleared and placed on another pair, or when suggested anchors appear for a legacy scene.
- **Fresh again:** the anchors return to the requested pair.
- **Never stale:** there is no capture, for example while the anchors are cleared.

Saving is unchanged: stale text is saved as it is, and a draft with no script location is still refused.

The editor dialog checks the draft against the current capture (`draft.capturedPlainText`) and checks the proposal against its stored baseline. A capture that changes or appears later never replaces that baseline. A newer `startProposal`, `discardProposal`, `loadScene` or `reset` replaces or drops the proposal along with its selection. Request tokens still decide whether a response applies.

These rules fix H2, where an accepted proposal was keyed to the anchors at accept time and so looked fresh for anchors it was never requested for.

### Existing compatibility behavior

These behaviors look questionable but are kept on purpose. Each is pinned by a test named "existing compatibility behavior", so a fix has to change that test deliberately.

| ID | Behavior |
|---|---|
| B5 | With explicit anchors but no capture (one anchor removed, or pages not yet indexed), a saved scene keeps its previously stored location while the page shows different anchors. |
| B6 | Saving stale text stores the new capture's location and raw text alongside the old or edited scene text. |
| C3 | Captured text can change while indexing progresses (the estimated action margin moves), but the editor dialog keeps the text it mounted with. |

## Entry points and ownership

The route `/movies/:movieId/scripts/:scriptId` is declared in `client/src/app/App.jsx`, which lazy-loads `@/pages/script-viewer`. The slice exports `ScriptViewerRoute` from `ui/ScriptViewerPage.jsx`. It keys the page by `scriptId`, so switching scripts remounts the page and starts a fresh draft.

| `useSceneDraft` (`model/sceneDraft.js`) | `ScriptViewerPage.jsx` |
|---|---|
| Draft state and every transition (a private pure reducer) | Loading the project, script and scenes; notices |
| Anchors in effect: explicit, or suggested | PDF rendering, windowing, scrolling, deep links |
| Capture memoization and captured text | Menus, dialogs, tabs, the marker toggle, the visitor's focused scene |
| Text origin, stale text, legacy text, the editor remount key | `window.confirm` prompts and all UI wording, including re-capture button labels |
| The dirty check | Keyboard and pointer wiring |
| Re-capture rules, the AI proposal lifecycle and request tokens | Network calls: AI formatting, scene create, update and delete |
| Save validation and payload (`buildSave`) | AI page snapshots and error-message mapping |
| | The overlap warning, scene bars in the margin, admin vs visitor behavior |

## Module map

All paths are under `client/src/pages/script-viewer/`.

| File | Role |
|---|---|
| `ui/ScriptViewerPage.jsx` | The route module and page: data loading, PDF, dialogs, navigation, and wiring the draft to the UI. |
| `model/sceneDraft.js` | `useSceneDraft` and `getTimingError` (also used by `AnnotatorPanel`). |
| `model/anchors.js` | Pure anchor helpers: geometry v2 read and write, placement and swapping, suggestions from saved text, scene segments, overlap. |
| `model/captureRange.js` | `captureAnchoredRange(textIndex, anchors)`: captured text, key, pages, offsets and context. Expensive. |
| `model/useScriptTextIndex.js` | Indexes every page's text lines in the background on a separate pdf.js worker. Publishes a new index object every 8 pages and on completion. |
| `model/usePdfPageWindowing.js` | Page sizing, mobile windowing and scrolling. |
| `ui/PdfPageFrame.jsx` | One memoized page plus its overlay: markers, range, scene bars, hover line. |
| `ui/AnnotatorPanel.jsx`, `ui/DraftEditorModal.jsx`, `ui/ScreenplayEditor.jsx`, `ui/AnchorContextMenu.jsx`, `ui/SavedScenesGrid.jsx`, `ui/ViewerTopBar.jsx` | Presentational components. `ScreenplayEditor` owns its blocks after mounting; the page remounts it through `draft.editorKey`. |
| `lib/pageSnapshots.js` | Renders cropped page images for the AI formatter. |
| `lib/pdfViewport.js`, `lib/platform.js` | Scroll helpers, typing-target detection, shortcut labels. |

## The `useSceneDraft` interface

```js
const textIndex = useScriptTextIndex(pdfDocument);
const [draft, draftActions] = useSceneDraft(textIndex);
```

`draft` is derived for the current render and is never stored:

| Field | Meaning |
|---|---|
| `savedScene` | The scene row as loaded or last saved, or `null` for a new draft. The page derives `draftSceneId` from its `id`. |
| `anchors`, `anchorsSuggested`, `canUndoAnchors` | The anchors in effect (`{ start, end }`), whether they are suggested, and whether anchor undo is available. |
| `startTime`, `endTime`, `tags` | Film timing as typed, and the selected tags in order. |
| `text`, `textOrigin` | The scene text saving would store, and where it came from. |
| `textStale`, `legacyText` | Stale text; saved text that belongs to no anchor pair. |
| `capturedPlainText` | The capture's plain text when the text isn't stale, else `""` (the draft's word check). |
| `recaptureOption`, `recaptureReplacesEdits` | `"none"`, `"recapture"` or `"revert"`, which the page turns into a button label; and whether re-capture would replace edited or AI text, in which case the page confirms first. |
| `editorKey` | Remount key for the editor. It stays the same on the first edit, so the caret isn't lost, and changes on reset, load, re-capture and accepting a proposal. |
| `proposal` | `null` or `{ status, markdown, error, capturedPlainText }`. `capturedPlainText` is the plain text of the capture the request was made from, else `""`; it is the baseline for the proposal's word check. The token and requested anchor key stay private. |
| `previewScene` | A scene-shaped preview for the panel's card and the dialog's page label. |
| `dirty` | Whether there are unsaved changes, used for the discard prompt. |

`draftActions` has one identity for the life of the hook, so its functions can be passed straight to memoized components: `loadScene`, `reset`, `setAnchorAtLine`, `removeAnchor`, `clearAnchors`, `undoAnchors`, `setTime`, `normalizeTime`, `toggleTag`, `clearTags`, `editText`, `recapture`, `startProposal`, `proposalReady`, `proposalFailed`, `acceptProposal`, `discardProposal`, `buildSave`, `prepareDelete`. The callbacks returned by `buildSave` and `prepareDelete` belong to individual requests.

Timing rules:

- Actions read the draft from the latest **commit**, through a ref assigned in a layout effect, never during render. Several actions called in one event all see the same draft, and `draft` shows their changes only after React commits. There are no synchronous state reads.
- `startProposal()` returns `null` for blank text, or the request data together with a fresh token. The proposal's selection and word-check baseline are taken from the same committed view as the request data. `proposalReady` and `proposalFailed` apply only if their token still matches. `acceptProposal()` reads nothing from the view; the proposal carries its selection. The token counter lives in a ref and is incremented at call time, never in the reducer, which `StrictMode` runs twice.
- Capture work (`captureAnchoredRange`) reruns only when the text index or the anchors in effect change. Anchor objects keep their identity while no anchor input changes, so memoized PDF pages don't re-render.

## Name mappings

| Glossary term | Client | HTTP | Database |
|---|---|---|---|
| Captured scene | script scene: `scenes`, `draft.savedScene` | `/movies/:movieId/scripts/:scriptId/scene-annotations` (list, create, update, delete); `GET /script-scenes` (search) | `script_scene_annotations` joined to `script_scene_anchors` |
| Script location | `page_start`/`page_end`, `start_offset`/`end_offset`, `context_prefix`/`context_suffix`, `anchor_geometry` | the same payload fields | `script_scene_anchors` columns |
| Scene anchor | `draft.anchors.start` / `.end`; version-2 geometry entries `{ kind, version: 2, unit: "pt", page, line, top, bottom, text }` | `anchor_geometry` | `script_scene_anchors.anchor_geometry` (JSONB) |
| Suggested anchors | `draft.anchorsSuggested`; anchors carrying `suggested: true` | never sent | never stored |
| Scene text | `draft.text` (panel and dialog prop `markdown`) | `formatted_selected_text`; `selected_text` mirrors it on save | `script_scene_anchors.formatted_selected_text`, `selected_text` |
| Raw text | — | `raw_selected_text` | `script_scene_anchors.raw_selected_text` |
| Text origin | `draft.textOrigin`: `"capture"`, `"edited"`, `"saved"`, `"ai"` (also the panel's badge keys) | — | — |
| Stale text | `draft.textStale` (panel prop `captureStale`) | — | — |
| Legacy scene | `draft.legacyText`; geometry without a valid version-2 start and end pair | `anchor_geometry` that isn't version-2 anchors | — |
| AI proposal | `draft.proposal` | `POST /api/script-scenes/format` | — |
| Film timing | `draft.startTime` / `endTime` | `start_time_seconds` / `end_time_seconds` | `script_scene_annotations.start_time_seconds` / `end_time_seconds` |

## Where to change draft behavior

| To change | Look in |
|---|---|
| What gets saved | `buildSave` in `model/sceneDraft.js` |
| Suggested anchors | `suggestAnchorsFromSavedText` in `model/anchors.js`, and the suggestions memo in `useSceneDraft` |
| Captured text layout | `model/captureRange.js` and `@/shared/lib/screenplay` |
| Line geometry and pointer snapping | `@/shared/lib/pdf-text` |
| Text origin, stale text, the editor key, the dirty check | `useSceneDraft` |
| Confirm wording and button labels | `ui/ScriptViewerPage.jsx` |
| AI requests | `startProposal` (what is sent) and `requestAiFormat` in the page (snapshots and the network call) |
| AI proposal selection and word-check baseline | `startProposal` and the `proposalAccept` transition in `useSceneDraft`; the proposal check in `ui/DraftEditorModal.jsx` |
| Indexing | `model/useScriptTextIndex.js` |

## Tests

Run the client tests from the repository root:

```bash
npm test --prefix client
```

Vitest runs with jsdom (`client/vitest.config.js`, setup in `client/src/test/setup.js`). The script viewer has two suites:

- **`ui/ScriptViewerPage.test.jsx`** characterizes the page end to end: capture, indexing, editing, re-capture, suggestions, saving, prompts, keys, AI proposals, visitors, and page-frame prop identity. It doubles only the edges: the API client, the session, `react-pdf`, the text indexer (a store the test publishes indexes to), page windowing, `PdfPageFrame` (which records the props of each render), AI page snapshots and `window.confirm`. Capture runs through a passthrough spy. The panel, dialogs, editor, anchors, capture and screenplay code are real.
- **`model/sceneDraft.test.jsx`** tests the hook's interface directly: the committed-view rule, identities, capture work, request tokens under `StrictMode`, AI proposal provenance, re-capture options, editor keys, undo limits, and the exact save mapping.

Both suites cover persistence response races: switching drafts, preserving newer edits, attaching the id from a first save, and keeping newer changes after deletion. Hook tests also cover an edit/reset and a response queued in the same React batch.

AI proposal provenance (H2) is covered in both suites.

- **Hook tests** check each case: an unchanged selection; anchors moved while pending and after readiness; cleared anchors; proposals requested for legacy and anchored saved scenes before any capture; and superseded and discarded requests.
- **Page tests (P13)** check the dialog's proposal word check and the panel's stale callout after the anchors move.

Shared fixtures live in `test/`. `textIndexFixtures.js` builds synthetic screenplay pages through the real line builder. Its `textIndexFrom` repeats the indexer's publish step (page offsets and the action margin), so keep it in step with `useScriptTextIndex.js`. `pageHarness.js` holds the page suite's doubles and helpers.

A test named "[ID] existing compatibility behavior: …", with a "Why this may be a bug" comment, pins behavior kept on purpose (see the table above).

jsdom has no layout, so real PDF rendering, pointer snapping and caret behavior need a browser. Check them manually against a non-production database: place anchors with `[` and `]`, edit in the dialog, re-capture, accept an AI proposal, save and reload.

Persistence was also verified on 2026-09-14 using Chromium, the real Express routes and serializers, and a disposable Postgres database with synthetic records. Login/session cookies, capture/save, reload/reopen, update, and delete passed. A delayed real save response preserved a newer time edit, which could then be saved to the same row. Only PDF delivery was replaced with a synthetic local fixture; all external browser traffic was blocked. This does not verify S3 credentials/CORS, actual AI responses, concurrent database overlap enforcement, or production deployment.
