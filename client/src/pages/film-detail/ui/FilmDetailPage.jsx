// client/src/pages/film-detail/ui/FilmDetailPage.jsx
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { sortStillsByTime } from "@/entities/still/model/stillTimeline.js";
import { getStillThumbnail } from "@/entities/still/model/still.js";
import { createFilmEditForm } from "@/entities/film/model/filmForms.js";
import { getHandedOverPosterUrl } from "@/entities/film/model/posterTransition.js";
import { useFilmSave } from "@/entities/film/model/filmSave.js";
import { getSceneScriptPath } from "@/entities/script-scene/model/capturedScene.js";
import { useSession } from "@/entities/session/model/useSession.js";
import { listStills } from "@/shared/api/stills.js";
import { getFilm } from "@/shared/api/films.js";
import { getFilmScript } from "@/shared/api/scripts.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { cx } from "@/shared/lib/cx.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { formatMomentToHms } from "@/shared/lib/time.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { PlusIcon } from "@/shared/ui/icons.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import { SceneViewerModal } from "@/widgets/scene-detail-modal/ui/SceneViewerModal.jsx";
import { StillTimeline } from "./StillTimeline.jsx";
import { FilmHeader, FilmHeaderSkeleton } from "./FilmHeader.jsx";
import { FilmScriptPanel } from "./FilmScriptPanel.jsx";
import { AddStillDialog } from "./AddStillDialog.jsx";
import { useStillEdit } from "./useStillEdit.jsx";
import styles from "./FilmDetailPage.module.css";

/**
 * A still in the grid. The callbacks take the still's id, so the page can pass
 * stable setters and hovering one still doesn't re-render the rest.
 */
const StillFrameButton = memo(function StillFrameButton({ still, onHover, onOpen }) {
  const thumbnail = getStillThumbnail(still);
  const url = useSignedMediaUrl(thumbnail.key, thumbnail.url);
  const time = formatMomentToHms(still.time_seconds);

  return (
    <button
      type="button"
      className={styles.frame}
      onClick={() => onOpen(still.id)}
      onMouseEnter={() => onHover(still.id)}
      onFocus={() => onHover(still.id)}
      onBlur={() => onHover(null)}
      aria-label={`Open still at ${time}`}
    >
      {url && <img src={url} alt="" loading="lazy" />}
      <span className={styles.frameTime}>{time}</span>
    </button>
  );
});

/**
 * The grid still under the pointer or keyboard focus, kept outside React
 * state: hovering re-renders only the timeline that marks it, not the page
 * and its hundreds of stills.
 */
function createHoveredStill() {
  let stillId = null;
  const listeners = new Set();
  return {
    get: () => stillId,
    set: (nextId) => {
      if (nextId === stillId) return;
      stillId = nextId;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The stills timeline, lit around whichever grid still is hovered. */
function HoverLinkedTimeline({ hoveredStill, stills, ...props }) {
  const hoveredId = useSyncExternalStore(hoveredStill.subscribe, hoveredStill.get);
  return (
    <StillTimeline
      stills={stills}
      highlightedIndex={hoveredId ? stills.findIndex((row) => row.id === hoveredId) : -1}
      {...props}
    />
  );
}

const NO_STILLS = [];
const SKELETON_FRAME_COUNT = 8;

/** Placeholder timeline and grid, shown while the stills list loads. */
function StillsSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className={styles.skeletonTimeline} />
      <ul className={styles.stillGrid}>
        {Array.from({ length: SKELETON_FRAME_COUNT }, (_, i) => (
          <li key={i}>
            <Skeleton className={styles.skeletonFrame} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FilmDetailPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  // Visitors get the same page without any of the editing controls.
  const { isAdmin: canEdit, user } = useSession();
  const filmSave = useFilmSave({ filmId: id, ownerId: user?.id });
  const [film, setFilm] = useState(null);
  // The film's stills sorted by time; null until they load.
  const [stillRows, setStillRows] = useState(null);
  const [script, setScript] = useState(null);
  const [err, setErr] = useState("");

  // The still the scene viewer opened on; null while it's closed.
  const [viewerStillId, setViewerStillId] = useState(null);
  // The grid still under the pointer or keyboard focus, marked on the timeline.
  const [hoveredStill] = useState(createHoveredStill);
  // Mounting the add dialog opens it on an empty form; unmounting discards it.
  const [addingStill, setAddingStill] = useState(false);

  const [scriptFile, setScriptFile] = useState(null);

  // The details being typed in the hero while its cover is open; null while it's closed.
  const [detailsDraft, setDetailsDraft] = useState(null);

  const lastDeepLinkedStillRef = useRef("");
  const loadIdRef = useRef(0);
  const stillIdFromQuery = searchParams.get("annotationId") || "";

  const stills = stillRows ?? NO_STILLS;
  const stillsLoading = stillRows === null;

  useDocumentTitle(film?.title || "Film");

  /**
   * Reloads the film. The details and the stills list are applied as each
   * arrives, so the header and script panel don't wait for the slower stills.
   * Only the latest load's responses apply.
   * The scene viewer stays open across reloads (moving to the nearest still if
   * its still was deleted) and closes once no stills remain.
   */
  async function load() {
    const loadId = ++loadIdRef.current;
    const isLatest = () => loadIdRef.current === loadId;
    setErr("");

    const details = Promise.all([getFilm(id), getFilmScript(id)]).then(([m, loadedScript]) => {
      if (!isLatest()) return;
      setFilm(m);
      setScript(loadedScript);
    });

    const stills = listStills(id).then((loadedStills) => {
      if (!isLatest()) return;
      const a = sortStillsByTime(loadedStills);
      setStillRows(a);
      if (a.length === 0) closeViewer();
    });

    try {
      await Promise.all([details, stills]);
    } catch (e) {
      if (isLatest()) setErr(getErrorMessage(e, "Failed to load film."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ?annotationId=… (from a scene's "Open first still") opens that still.
  useEffect(() => {
    if (!stillIdFromQuery) {
      lastDeepLinkedStillRef.current = "";
      return;
    }
    if (lastDeepLinkedStillRef.current === stillIdFromQuery) return;
    if (!stills.some((row) => row.id === stillIdFromQuery)) return;

    lastDeepLinkedStillRef.current = stillIdFromQuery;
    setViewerStillId(stillIdFromQuery);
  }, [stillIdFromQuery, stills]);

  const runtimeSeconds = useMemo(() => {
    if (!film?.runtime_minutes) return 0;
    return Number(film.runtime_minutes) * 60;
  }, [film]);

  const stillEdit = useStillEdit({ filmId: id, runtimeSeconds, onChange: load });

  function closeViewer() {
    setViewerStillId(null);
    stillEdit.reset();
  }

  async function saveScriptPdf() {
    if (!scriptFile) return;
    // Scene anchors point into the PDF they were captured from, so replacing it
    // deletes the script's captured scenes and the tagging on them.
    if (
      script &&
      !window.confirm(
        "Replace this script? Every scene captured from it, and the tags on those scenes, will be deleted. This can't be undone."
      )
    ) {
      return;
    }
    setErr("");

    try {
      const saved = await filmSave.save({ scriptFile });
      setScriptFile(null);
      setScript(saved.script || await getFilmScript(id));
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save script PDF."));
    }
  }

  function startFilmEdits() {
    setDetailsDraft(createFilmEditForm(film));
  }

  async function submitFilmEdits() {
    setErr("");
    try {
      await filmSave.save({ form: detailsDraft });
      await load();
      setDetailsDraft(null);
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save film details."));
    }
  }

  function leaveFilmSave() {
    if (!filmSave.recovery) return true;
    if (!window.confirm("Leave this unfinished save? Completed work will stay saved. Unsaved inputs will be discarded.")) return false;
    try {
      filmSave.leave();
      setScriptFile(null);
      load();
      return true;
    } catch (error) {
      setErr(getErrorMessage(error));
      return false;
    }
  }

  function cancelFilmEdits() {
    if (!leaveFilmSave()) return;
    setDetailsDraft(null);
  }

  const coverUrl = useSignedMediaUrl(film?.cover_image_key, film?.cover_image_url);
  function openScript() {
    if (script) nav(`/films/${id}/scripts/${script.id}`);
  }

  if (!film) {
    return (
      <div className={styles.page}>
        {err ? (
          <div className={cx(styles.content, styles.loadError)}>
            <Callout tone="error">{err}</Callout>
          </div>
        ) : (
          <FilmHeaderSkeleton posterUrl={getHandedOverPosterUrl(location.state)} posterKey={location.state?.posterKey} />
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <FilmHeader
        film={film}
        coverUrl={coverUrl}
        stills={stills}
        onOpenStill={setViewerStillId}
        edit={
          canEdit
            ? {
                values: detailsDraft,
                saving: filmSave.saving,
                onStart: startFilmEdits,
                onChange: (field, value) => setDetailsDraft((draft) => ({ ...draft, [field]: value })),
                onSave: submitFilmEdits,
                onDiscard: cancelFilmEdits,
              }
            : null
        }
      />

      <div className={styles.content}>
        {err && !viewerStillId && <Callout tone="error">{err}</Callout>}
        {canEdit && filmSave.recovery && !filmSave.saving && (
          <Callout tone="info">
            {filmSave.recovery.message}{" "}
            <Link to={`/films/${id}/edit`}>Resume film save</Link>
          </Callout>
        )}

        <FilmScriptPanel
          currentScript={script}
          onOpenScript={openScript}
          canEdit={canEdit}
          scriptFile={scriptFile}
          savingScript={filmSave.saving}
          onScriptFileChange={(file) => {
            if (file || leaveFilmSave()) setScriptFile(file);
          }}
          onSaveScript={saveScriptPdf}
        />

        <section aria-labelledby="film-stills-heading" aria-busy={stillsLoading}>
          <SectionHeading
            id="film-stills-heading"
            title="Film stills"
            count={stillsLoading ? undefined : stills.length}
            actions={
              canEdit &&
              stills.length > 0 && (
                <Button size="sm" onClick={() => setAddingStill(true)}>
                  <PlusIcon size={14} />
                  Add still
                </Button>
              )
            }
          />

          {stillsLoading ? (
            !err && <StillsSkeleton />
          ) : stills.length === 0 ? (
            <EmptyState
              className={styles.stillsEmpty}
              title="No stills yet"
              action={
                canEdit && (
                  <Button size="sm" variant="primary" onClick={() => setAddingStill(true)}>
                    <PlusIcon size={14} />
                    Add the first still
                  </Button>
                )
              }
            >
              {canEdit
                ? "Add frames from the film at their timestamps. A still inside a captured scene appears on that scene."
                : "No stills have been added to this film yet."}
            </EmptyState>
          ) : (
            <>
              {/* Pins under the header while the grid scrolls past. */}
              <div className={styles.timelineDock}>
                <HoverLinkedTimeline
                  hoveredStill={hoveredStill}
                  stills={stills}
                  onSelect={(index) => setViewerStillId(stills[index]?.id ?? null)}
                  runtimeSeconds={runtimeSeconds}
                  selectedIndex={stills.findIndex((row) => row.id === viewerStillId)}
                />
              </div>
              {/* Leaving the grid, not each still, clears the highlight, so it holds across the gaps. */}
              <ul className={styles.stillGrid} onMouseLeave={() => hoveredStill.set(null)}>
                {stills.map((still) => (
                  <li key={still.id}>
                    <StillFrameButton still={still} onHover={hoveredStill.set} onOpen={setViewerStillId} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {viewerStillId && (
        <SceneViewerModal
          key={viewerStillId}
          initial={{ view: "still", stillId: viewerStillId }}
          source={{ film: { ...film, scriptId: script?.id ?? null, stills: stills } }}
          onClose={closeViewer}
          onSelectTag={(tag) => nav(`/script-search?tag=${encodeURIComponent(tag)}`)}
          onOpenScene={(scene) => nav(getSceneScriptPath(scene))}
          renderActions={canEdit ? stillEdit.renderActions : undefined}
          renderStillTools={!canEdit ? undefined : (still) => (
            <>
              {err && <Callout tone="error">{err}</Callout>}
              {stillEdit.renderStillTools(still)}
            </>
          )}
        />
      )}

      {addingStill && (
        <AddStillDialog
          filmId={id}
          runtimeSeconds={runtimeSeconds}
          onAdded={load}
          onClose={() => setAddingStill(false)}
        />
      )}
    </div>
  );
}
