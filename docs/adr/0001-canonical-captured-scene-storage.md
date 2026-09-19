# Canonical captured-scene storage

Status: accepted (2026-09-16)

## Context

A captured scene is one domain object: its script location, scene text, raw text,
film timing, and tags are created and changed together. Splitting that state across
multiple one-to-one tables duplicated ownership fields, made text precedence
ambiguous, and left important validity rules enforceable only in application code.

Scene anchors also need to participate in ordering and overlap rules. Storing them
inside an untyped JSON array made those rules difficult to express or protect at
the database boundary.

## Decision

1. A captured scene is stored in one `captured_scenes` row owned by its script.
   The movie is reached through the script.
2. The start and end scene anchors use typed columns. The HTTP contract exposes
   them together as `script_location.start` and `script_location.end`; a stored
   captured scene never has only half of a script location.
3. Script-location overlap is prevented by a database exclusion constraint over
   an inclusive range derived from each anchor's page and line.
4. Positive-length film-timing overlap is prevented by a database exclusion
   constraint. A per-script advisory lock remains necessary to serialize the
   complete rule, including zero-length timings, and to return a useful conflict.
5. `scene_text` and `raw_text` are the only stored text fields. Both are
   required and non-blank.
6. Captured-scene tags must come from the shared taxonomy in
   `server/src/domain/script-tags.js`. The client imports that source through its
   Vite alias so there is one taxonomy.
7. Database shape is owned by ordered SQL files in `server/sql/migrations/` and
   the `schema_migrations` ledger. The migration runner refuses incompatible
   pre-ledger captured-scene tables instead of guessing how to transform them.

## Alternatives considered

- Keeping separate anchor and annotation tables was rejected because their rows
  have the same lifecycle and no independent owner.
- Keeping anchors as JSON was rejected because typed columns allow database
  constraints and direct HTTP shaping without application-only interpretation.
- Relying only on application validation was rejected because invalid overlapping
  data would remain representable through other write paths.
- Relying only on constraints was rejected because zero-length film timings need
  serialization and callers need the conflicting scene identified.
- Duplicating or generating the tag taxonomy was rejected because it creates
  multiple sources of truth.

## Consequences

- Stored captured scenes always have a complete script location, non-blank scene
  and raw text, valid taxonomy tags, and non-overlapping locations and timings.
- Script page labels, ordering, and links derive from the typed scene anchors;
  page ranges are not stored separately.
- The client depends on the server-owned taxonomy module. Vite development,
  builds, and tests must retain the corresponding alias and filesystem allowance.
- `node server/src/migrate.js` is the only supported way to change database
  shape. Incompatible databases require a matching backup/application recovery
  or a fresh database; they are never transformed implicitly.
