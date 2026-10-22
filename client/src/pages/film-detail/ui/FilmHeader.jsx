import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FILM_CREDITS } from "@/entities/film/model/filmCredits.js";
import { filmPosterProps } from "@/entities/film/model/posterTransition.js";
import { sortStillsByTime } from "@/entities/still/model/stillTimeline.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { cx } from "@/shared/lib/cx.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { formatMinutesToHms, formatMomentToHms, normalizeTypedTime } from "@/shared/lib/time.js";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import { StillTimelineGlance } from "./StillTimeline.jsx";
import styles from "./FilmDetailPage.module.css";

const NO_STILLS = [];
// How many of the film's stills take turns behind the hero.
const BACKDROP_STILL_COUNT = 6;
// How long each backdrop still holds before the next one fades in.
const BACKDROP_HOLD_MS = 7000;
const NO_TURNS = { source: null, ids: [], currentId: null, shownIds: new Set() };

/**
 * The film's details as the hero sets them: the title, then the facts under
 * it. `field` is the detail's key in the film edit form (`createFilmEditForm`)
 * and `format` reads it off the film for the hero at rest. `numeric` facts are
 * set in Slate, like every timecode and count.
 */
const TITLE = { field: "title", label: "Title", placeholder: "Title", format: (film) => film.title };
const FACTS = [
  {
    field: "year",
    label: "Year",
    placeholder: "YYYY",
    inputMode: "numeric",
    numeric: true,
    format: (film) => film.year,
  },
  {
    field: "runtime_hms",
    label: "Runtime",
    placeholder: "HH:MM:SS",
    numeric: true,
    normalize: normalizeTypedTime,
    format: (film) => (film.runtime_minutes ? formatMinutesToHms(film.runtime_minutes) : ""),
  },
  ...FILM_CREDITS.map(({ field, label, required }) => ({
    field,
    label,
    placeholder: required ? "Name" : "Optional",
    format: (film) => film[field],
  })),
];
// The dotted lines sweep in one after another: the title's, then each fact's.
const SWEEP_FIRST_FACT_MS = 70;
const SWEEP_STEP_MS = 40;

/**
 * Up to `count` ids of stills with a viewable image, picked at random and put
 * in film order, so the caption's playhead moves forward through the film.
 */
function pickBackdropIds(stills, count) {
  const ids = stills.filter((row) => row.image_url).map((row) => row.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const picked = new Set(ids.slice(0, count));
  return sortStillsByTime(stills.filter((row) => picked.has(row.id))).map((row) => row.id);
}

/**
 * The turn order for a new stills list. The first list picks it at random. A
 * reload keeps it, less any stills that were deleted, and keeps the still on
 * screen, or moves to the next one when that still was deleted. The order is
 * picked anew only when none of its stills are left.
 */
function retakeTurns(turns, stills) {
  const viewable = new Set(stills.filter((row) => row.image_url).map((row) => row.id));
  const kept = turns.ids.filter((stillId) => viewable.has(stillId));
  if (kept.length === 0) {
    const ids = pickBackdropIds(stills, BACKDROP_STILL_COUNT);
    return { source: stills, ids, currentId: ids[0] ?? null, shownIds: new Set(ids.slice(0, 1)) };
  }
  const from = turns.ids.indexOf(turns.currentId);
  const currentId = [...turns.ids.slice(from), ...turns.ids.slice(0, from)].find((stillId) => viewable.has(stillId));
  return { source: stills, ids: kept, currentId, shownIds: new Set(turns.shownIds).add(currentId) };
}

function nextTurnId(turns) {
  return turns.ids[(turns.ids.indexOf(turns.currentId) + 1) % turns.ids.length];
}

function advanceTurn(turns) {
  const currentId = nextTurnId(turns);
  return { ...turns, currentId, shownIds: new Set(turns.shownIds).add(currentId) };
}

/**
 * Which of the film's stills take turns behind the hero, and which one is on
 * screen. Turns are tracked by still id, so a reload that deletes a still
 * elsewhere in the order leaves the one on screen alone. A still stays mounted
 * once shown, and the next one mounts early, so each has loaded by the time it
 * fades in. With reduced motion the first still simply stays.
 */
function useBackdropTurns(stills) {
  const reducedMotion = usePrefersReducedMotion();
  const [turns, setTurns] = useState(NO_TURNS);
  if (turns.source !== stills) setTurns(retakeTurns(turns, stills));
  const cycling = turns.ids.length > 1 && !reducedMotion;

  useEffect(() => {
    if (!cycling) return undefined;
    const timer = window.setTimeout(() => setTurns(advanceTurn), BACKDROP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [cycling, turns.currentId]);

  const byId = new Map(stills.map((row) => [row.id, row]));
  const nextId = cycling ? nextTurnId(turns) : null;
  return {
    current: byId.get(turns.currentId) ?? null,
    mounted: turns.ids
      .filter((stillId) => turns.shownIds.has(stillId) || stillId === nextId)
      .map((stillId) => byId.get(stillId))
      .filter(Boolean),
  };
}

/** The hero's backdrop stills: each slowly pushes in and then dissolves into the next. */
function BackdropStills({ current, mounted }) {
  const [loadedIds, setLoadedIds] = useState(() => new Set());

  return mounted.map((still) => (
    <img
      key={still.id}
      className={cx(
        styles.backdrop,
        styles.backdropStill,
        still.id === current.id && loadedIds.has(still.id) && styles.backdropLoaded
      )}
      src={still.image_url}
      alt=""
      onLoad={() => setLoadedIds((value) => new Set(value).add(still.id))}
    />
  ));
}

/**
 * Where the backdrop still falls in the film, on the stills timeline in
 * miniature; a click opens that still. It shows no text, so its label names
 * the still for screen readers and as a tooltip.
 */
function BackdropTimeline({ current, stills, runtimeSeconds, onOpenStill }) {
  const label = `Open the still at ${formatMomentToHms(current.time_seconds)}`;

  return (
    <button
      type="button"
      className={styles.backdropTimeline}
      onClick={() => onOpenStill?.(current.id)}
      aria-label={label}
      title={label}
    >
      <StillTimelineGlance stills={stills} runtimeSeconds={runtimeSeconds} stillId={current.id} />
    </button>
  );
}

/**
 * One of the hero's details, set as text. For an admin it carries a dotted
 * line that sweeps in while the cover is pointed at. With the editor open an
 * input lies exactly over the text, which stays behind it unseen to size the
 * box, so typing moves nothing but what follows on the line. The title's input
 * wraps like the heading it sits in.
 */
function DetailField({ detail, value, edit, multiline, sweepDelayMs, caret }) {
  const editing = Boolean(edit.values);
  const Control = multiline ? "textarea" : "input";

  function handleKeyDown(event) {
    if (event.nativeEvent.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return;
    event.preventDefault();
    if (edit.saving) return;
    if (event.key === "Enter") edit.onSave();
    else edit.onDiscard();
  }

  return (
    <span
      className={cx(styles.field, multiline && styles.fieldTitle)}
      style={{ "--sweep-delay": `${sweepDelayMs}ms` }}
    >
      <span className={styles.fieldText}>
        {editing ? value || detail.placeholder : value}
        {/* Blinks at the end of the last detail while the cover is pointed at. */}
        {caret && <span className={styles.fieldCaret} aria-hidden="true" />}
      </span>
      {editing && (
        <Control
          className={styles.fieldInput}
          name={detail.field}
          aria-label={detail.label}
          value={value}
          placeholder={detail.placeholder}
          inputMode={detail.inputMode}
          spellCheck={false}
          autoComplete="off"
          readOnly={edit.saving}
          rows={multiline ? 1 : undefined}
          onChange={(event) => {
            // A title is one line, even pasted.
            const typed = multiline ? event.target.value.replace(/[\r\n]+/g, " ") : event.target.value;
            edit.onChange(detail.field, typed);
          }}
          onBlur={(event) => {
            const normalized = detail.normalize?.(event.target.value);
            if (normalized !== undefined && normalized !== event.target.value) edit.onChange(detail.field, normalized);
          }}
          onKeyDown={handleKeyDown}
        />
      )}
    </span>
  );
}

/**
 * Full-width film hero. A few of the film's stills, picked at random, take
 * turns as the backdrop in film order, and the stills timeline in miniature,
 * along the hero's bottom line, marks where each falls; without any stills, a
 * blurred copy of the cover stands in. Only details that are filled in show.
 *
 * For an admin (`edit`, null for visitors) the cover is bound like a script.
 * Pointed at, it lifts off the page beneath and dotted lines sweep under the
 * title and facts, ending in a blinking caret. Clicked, it swings open: every
 * detail, filled in or not, becomes an input in place, the caret becomes the
 * last one's, and Save and Discard stand in for the timeline. Enter or a click
 * on the open cover saves; Esc discards. `edit.values` holds the details being
 * typed while the editor is open and is null while it's closed.
 */
export function FilmHeader({ film, coverUrl, stills = NO_STILLS, onOpenStill, edit = null }) {
  const backdrop = useBackdropTurns(stills);
  const runtimeSeconds = Number(film.runtime_minutes) * 60 || 0;
  // The timeline needs a runtime to place the still on.
  const showTimeline = Boolean(backdrop.current) && runtimeSeconds > 0;
  const editing = Boolean(edit?.values);
  const shownFacts = FACTS.filter((fact) => fact.format(film));
  const facts = editing ? FACTS : shownFacts;
  // The caret that blinks at the end of the details is where opening the cover puts the real one.
  const caretField = (shownFacts.at(-1) ?? TITLE).field;
  // The stills load after the header, so the cover fades in rather than popping when stills replace it.
  const [coverLoaded, setCoverLoaded] = useState(false);
  const bodyRef = useRef(null);
  const titleRef = useRef(null);
  const wasEditingRef = useRef(false);

  // Closing the editor takes away the input or button that had focus. Focus
  // goes to the title, which reads out what was kept, rather than back to the
  // cover, where keyboard focus would hold it lifted when it should close.
  useEffect(() => {
    const active = document.activeElement;
    if (wasEditingRef.current && !editing && (!active || active === document.body)) {
      titleRef.current?.focus({ preventScroll: true });
    }
    wasEditingRef.current = editing;
  }, [editing]);

  function openEditor() {
    flushSync(edit.onStart);
    const input = bodyRef.current?.querySelector(`[name="${caretField}"]`);
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function detailValue(detail) {
    return editing ? edit.values[detail.field] : detail.format(film);
  }

  const poster = coverUrl ? (
    <img className={styles.poster} src={coverUrl} alt={edit ? "" : `${film.title} cover`} {...filmPosterProps} />
  ) : (
    <span className={styles.poster} aria-hidden="true" />
  );
  const coverLabel = editing ? "Save details" : "Edit details";

  return (
    <section className={styles.hero}>
      {backdrop.current ? (
        <BackdropStills current={backdrop.current} mounted={backdrop.mounted} />
      ) : (
        coverUrl && (
          <img
            className={cx(styles.backdrop, styles.backdropBlurred, coverLoaded && styles.backdropLoaded)}
            src={coverUrl}
            alt=""
            onLoad={() => setCoverLoaded(true)}
          />
        )
      )}

      <div className={cx(styles.heroInner, editing && styles.heroEditing)}>
        {edit ? (
          <div className={styles.cover}>
            <span className={styles.coverPage} aria-hidden="true" />
            <button
              type="button"
              className={styles.coverButton}
              aria-label={coverLabel}
              title={coverLabel}
              disabled={edit.saving}
              onClick={editing ? () => edit.onSave() : openEditor}
            >
              <span className={styles.coverFlap}>{poster}</span>
            </button>
          </div>
        ) : (
          poster
        )}

        <div ref={bodyRef} className={styles.heroBody}>
          <p className={styles.eyebrow}>Film</p>
          <h1 ref={titleRef} className={styles.heroTitle} tabIndex={edit ? -1 : undefined}>
            {edit ? (
              <DetailField
                detail={TITLE}
                value={detailValue(TITLE)}
                edit={edit}
                multiline
                sweepDelayMs={0}
                caret={caretField === TITLE.field}
              />
            ) : (
              film.title
            )}
          </h1>
          {facts.length > 0 && (
            <dl className={styles.facts}>
              {facts.map((fact, index) => (
                <div key={fact.field}>
                  <dt>{fact.label}</dt>
                  <dd className={fact.numeric ? styles.factNumber : undefined}>
                    {edit ? (
                      <DetailField
                        detail={fact}
                        value={detailValue(fact)}
                        edit={edit}
                        sweepDelayMs={SWEEP_FIRST_FACT_MS + index * SWEEP_STEP_MS}
                        caret={caretField === fact.field}
                      />
                    ) : (
                      fact.format(film)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {(showTimeline || edit) && (
            <div className={styles.heroFoot}>
              {showTimeline && (
                <BackdropTimeline
                  current={backdrop.current}
                  stills={stills}
                  runtimeSeconds={runtimeSeconds}
                  onOpenStill={onOpenStill}
                />
              )}
              {editing && (
                <div className={styles.editActions}>
                  <button
                    type="button"
                    className={cx(styles.editAction, styles.editSave)}
                    title="Save (Enter)"
                    disabled={edit.saving}
                    onClick={() => edit.onSave()}
                  >
                    {edit.saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className={styles.editAction}
                    title="Discard (Esc)"
                    disabled={edit.saving}
                    onClick={() => edit.onDiscard()}
                  >
                    Discard
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Placeholder with the hero's shape, shown while the film loads. A film
 * opened from its card already has the card's cover (`posterUrl`), so it shows
 * that rather than a blank poster.
 */
export function FilmHeaderSkeleton({ posterUrl: handedUrl = "", posterKey }) {
  const posterUrl = useSignedMediaUrl(posterKey, handedUrl);
  return (
    <section className={styles.hero} aria-hidden="true">
      <div className={styles.heroInner}>
        {posterUrl ? (
          <img className={styles.poster} src={posterUrl} alt="" {...filmPosterProps} />
        ) : (
          <Skeleton className={styles.poster} />
        )}
        <div className={styles.heroBody}>
          <Skeleton className={styles.skeletonEyebrow} />
          <Skeleton className={styles.skeletonTitle} />
          <Skeleton className={styles.skeletonFacts} />
        </div>
      </div>
    </section>
  );
}
