# Canonical captured-scene storage

Status: accepted (2026-09-16, at gate G2 of the codebase overhaul)

Captured scenes are stored across two tables with a one-to-one relationship, three text
columns for two concepts, a superseded `script_annotations` table that the deploy-time
migration re-imports on every run, location metadata nothing reads, and a JSON geometry blob
that only application code can interpret. We will replace all of it, in one irreversible
maintenance cutover, with a single `captured_scenes` table owned by its script, typed scene
anchor columns, one scene text field and one raw text field, and a numbered migration history;
the overlap rules that used to live only in application code become exclusion constraints
wherever they can be expressed exactly.

The implementable detail is the `## Contract` section of
`.scratch/codebase-overhaul/issues/10-canonical-contract-design.md`, which issues 11–13 build
against. This record holds the decisions and why the alternatives lost.

## Context

- The audit (`.scratch/codebase-cleanup/spec.md`, A1 and A4–A9, B4, C7, E2) found that every
  captured-scene write touches `script_scene_anchors` and `script_scene_annotations` together,
  that no runtime operation manages an anchor row independently, and that both tables carry
  their own `movie_id` and `script_id` beside the script they already belong to.
- `sceneDraft.js` writes the same value to `selected_text` and `formatted_selected_text`, and
  three readers each pick a different fallback order, so "the scene's text" has no single
  answer in the data.
- Scene anchors live in an `anchor_geometry` JSONB array of `{kind, version, unit, page, line,
  top, bottom, text}` entries. The server can't compare them in SQL, so overlap is enforced by
  reading every other scene of the script into Node under a per-script advisory lock (issue 04).
- Production has no legacy scenes (spec Decision 4), and the G1 production inventory (run
  `inventory-20260916T172941Z`) confirms it: 1 captured scene, with a valid anchor pair, and no
  overlapping pairs. So this is a conversion of well-formed data, not a rescue of unrecoverable
  records.
- The same inventory found no production row without stored formatted text and no unknown tag.
  Locally, every row that has either belongs to a scene that aborts for lack of anchors.
- Only one deployment exists, one admin writes to it, and the release is a coordinated
  maintenance cutover (E2), so migrations do not have to stay compatible with the running API.
- The tag taxonomy lives in `client/`, but the production image is built from a context holding
  `server/` alone (`infra/deploy-prod.sh` rsyncs `$ROOT_DIR/server/`; `server/Dockerfile` copies
  that context). `server/src/tools/inventory.js` already imports the taxonomy across that
  boundary, which is why issue 03 had to bundle the inventory command with esbuild to run it in
  production at all.

## Decision

1. **One table, `captured_scenes`, owned by `scripts`.** It keeps the existing scene ids, has a
   single `script_id` foreign key, and carries the location, text, timing and tags of the scene.
   `script_scene_anchors`, `script_scene_annotations`, `script_annotations`, `anchor_id` and
   `legacy_annotation_id` all disappear. The movie is reached through the script.
2. **Scene anchors become typed columns**, `start_page`/`start_line`/`start_top`/`start_bottom`/
   `start_text` and the matching `end_*`, rather than a JSON array. Over HTTP they are one
   `script_location` object with a `start` and an `end`, because half a pair means nothing.
3. **The overlap rules become exclusion constraints where they are exact.** Script location is
   exact: `(page, line)` encodes into a monotone `bigint`, and an inclusive `int8range` `&&`
   reproduces the lexicographic rule across pages. Film timing is exact only for scenes whose
   timing has a length: `int4range(start, end, '[)')` allows touching, but a zero-length timing
   produces an empty range that overlaps nothing, while the rule says it overlaps any scene
   strictly containing it. So the film-timing constraint is partial (`WHERE start < end`), and
   issue 04's per-script advisory lock stays as the rule's enforcer and as what makes the 409
   name the conflicting scene.
4. **One scene text field and one raw text field**, `scene_text` and `raw_text`, both required
   and non-blank, named for the glossary. No fallback chain survives anywhere.
5. **A numbered migration history replaces the replayed runner.** `schema_migrations` plus a
   runner over `server/sql/migrations/NNNN_*.sql`; migration `0001` is the canonical schema, so
   a fresh install creates only that. The production database is brought to the same state by a
   one-use conversion command, which converts and stamps version 1 in one transaction, and is
   deleted after the cutover (issue 18). The local database is dropped and recreated instead.
6. **Code that the API, its commands and the client all need lives under `server/`.** `server/`
   is the only tree the image ships, and it ships alone, while the client is built from a full
   checkout and can always see `server/`. So the dependency points from the client into
   `server/`, never the other way. The tag taxonomy, which the write-time rule (§4 of the
   Contract) and the conversion both check, moves to `server/src/domain/script-tags.js`, and the
   client imports it through a Vite alias. One copy, nothing generated, and no change to the build
   context. The screenplay grammar stays in the client, because no server code parses scene text
   (decision 7).
7. **The conversion copies what is stored and never generates or guesses.** Scene text and raw
   text are copied verbatim, and a row whose stored text is blank aborts. Every tag must already be
   a taxonomy value, and any other value aborts: there is no mapping table. Issue 14 deletes the
   legacy plain-text parser from the client grammar outright.

## Alternatives considered

- **Keep the two tables and clean up in place.** Rejected: every rule already spans both tables,
  each write updates both, and the split forces the composite `(script_id, movie_id)` foreign
  key that requires duplicating `movie_id` on both rows. Nothing is gained by the separation.
- **Keep anchors as JSONB and index expressions over it.** Rejected: an exclusion constraint
  needs stable, immutable expressions, and extracting "the last valid entry of kind `end`" from
  an array is neither. Typed columns also let `NOT NULL`, range and ordering checks do the work
  that hand-written validation does today, and they read back directly as the viewer's
  `{page, line, top, bottom, text}`.
- **Drop the advisory lock and rely on the constraints alone.** Rejected while zero-length
  timings are legal (the client accepts `end == start`, and G2 kept it). A constraint violation
  also arrives as SQLSTATE 23P01 naming a constraint, not a scene, so the server would have to
  re-query in a fresh transaction to keep the 409 detail the API contract promises.
- **Keep the constraints out and leave the lock alone.** Rejected: the lock only binds code that
  remembers to take it. The constraints make an overlapping pair unrepresentable for the
  conversion command, the admin CLI and any hand-written SQL, and they turn a future missed
  check into a rejected write instead of corrupt data.
- **Convert with SQL only.** Rejected: the conversion reads each anchor pair strictly out of a
  JSON geometry array (each kind's last strictly valid entry), checks tags against the taxonomy
  module, and collects every failure with its ids before writing anything. That is a Node
  command, not a `.sql` migration.
- **Generate scene text for rows without formatted text**, by moving the legacy parser into the
  conversion and checking word fidelity over a stream of letters and digits. Rejected at G2: no
  convertible row needs it. Production has no row without formatted text, and the 2 local ones
  belong to scenes that abort for lack of anchors.
- **Check that stored markdown parses back the same way**, which would move the screenplay
  grammar under `server/` for the conversion alone. Rejected at G2: it covers exactly one
  production scene, which a person opens in the viewer before and after the cutover instead, and
  once the one-use command is deleted the grammar would sit in `server/` with only client
  consumers.
- **A mapping table that maps or drops each unknown tag.** Rejected at G2: production has no
  unknown tags, and all 12 local values sit on scenes that abort for lack of anchors, so the
  table would map no convertible row.
- **A repo-level `shared/` module included in both builds** (instead of decision 6). Rejected: it
  ships only if the deploy script rsyncs a second path *and* the build context reproduces the
  repository's layout, because otherwise the relative depth of the import differs between the
  checkout and the image, so it resolves in one and not the other. Making that work means moving
  the image's `WORKDIR`, and changing the Dockerfile, the rsync, every `node src/…` command in
  `infra/run-api-task.sh`, the task definition and the runbook — a larger and riskier change than
  a move, for nothing extra.
- **A generated copy under `server/`, with a test asserting it equals the client's.** Rejected by
  "Replace, don't layer": it is two copies of one truth plus a generator and a check to keep them
  equal, and a stale checked-in copy still ships.
- **A backward-compatible, reversible migration with field aliases.** Rejected by the spec
  (E2 and "Replace, don't layer"): with one deployment and a maintenance window, a matching
  database-and-application pair restored from a snapshot is the recovery path, and permanent
  dual contracts are the thing this overhaul removes.

## Consequences

- The cutover is irreversible. Recovery restores the RDS snapshot together with the previous
  task definition and the previous frontend; the old API must never run against the new schema.
- Every captured scene needs a valid anchor pair, so the conversion aborts rather than invent
  one, and clearing every anchor in the editor makes a draft unsaveable until anchors return.
- Stored geometry that the strict version-2 check rejects, and existing pairs of overlapping
  scenes, are now unrepresentable: they must be resolved by a person before the cutover.
- The page range is no longer stored. `page_start`/`page_end` are derived from the anchors, so
  scene ordering, page labels and scene links read the anchor pair instead.
- Zero-length film timings stay possible and are policed only by the advisory lock. If they are
  ever forbidden, the film-timing constraint loses its `WHERE` clause and becomes total.
- Free-form tags stop being a second tag system: writes accept only taxonomy values, and the
  conversion aborts on any existing value outside the taxonomy.
- After the cutover, `node src/migrate.js` is the only way a database changes shape, and it
  refuses to run against a database that still holds the legacy tables.
- The client imports the taxonomy from outside its own project root, so `client/vite.config.js`
  gains an alias and the Vite **dev server** needs `server.fs.allow` to serve it. `vite build` and
  `vitest` need only the alias. The backend build context and `server/Dockerfile` do not change,
  and the cutover proves that by running the conversion's read-only `--check` mode inside the
  built image, against live production, before writers are stopped. It has to be `--check`:
  production's pre-cutover state is precisely the state the conversion treats as convertible, so
  the plain command would convert and commit there, ahead of the snapshot.
- The dry run doesn't prove that stored scene text is readable by the canonical parser. The one
  production captured scene is opened in the viewer before and after the cutover instead.
- The conversion's tests run against a dump of the local legacy database taken at G2, restored
  into throwaway databases, because the local database itself is dropped rather than converted.
