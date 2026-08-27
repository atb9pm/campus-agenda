"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";

import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items";
import type { SchoolWeek } from "@campus/features/calendar";
import {
  appendWeekNote,
  clampWeekDisplayCount,
  formatWeekColumnLabel,
  formatWeekColumnSubtitle,
  listWeekNotes,
  moveWeekNote,
  removeWeekNote,
  type ClassNotesDocument,
  type NotebookClipboard,
  type WeekDisplayCount,
  weekNotesKey,
  visibleSchoolWeeks,
} from "@campus/features/class-notebook";
import type { TeacherClassSetup } from "@campus/features/teacher-setup";
import { ControlsModal } from "./controls-modal.tsx";

interface ClassNotebookPanelProps {
  classSetup: TeacherClassSetup;
  schoolWeeks: SchoolWeek[];
  centerWeekNumber: number;
  items: PrototypeAgendaItem[];
  notesDocument: ClassNotesDocument;
  canPublish: boolean;
  publishBlockedReason?: string;
  onBack: () => void;
  onShiftWeeks: (direction: -1 | 1) => void;
  onCenterWeekChange: (weekNumber: number) => void;
  onNotesChange: (document: ClassNotesDocument) => void;
  onCreatePublication: (schoolWeekNumber: number, text: string) => Promise<void>;
  onMovePublication: (itemId: number, schoolWeekNumber: number) => Promise<void>;
  onDeletePublication: (itemId: number) => Promise<void>;
  onSaveControl: (input: { schoolWeekNumber: number; day: number; title: string }) => Promise<void>;
  onDeleteControl: (itemId: number) => Promise<void>;
  onPreviewStudent?: () => void;
}

type LineSelection =
  | { kind: "publication"; itemId: number; weekNumber: number }
  | { kind: "note"; noteId: string; weekNumber: number };

function isPublicationLine(item: PrototypeAgendaItem): boolean {
  return item.type === "HOMEWORK" || item.type === "INFORMATION";
}

export function ClassNotebookPanel({
  classSetup,
  schoolWeeks,
  centerWeekNumber,
  items,
  notesDocument,
  canPublish,
  publishBlockedReason,
  onBack,
  onShiftWeeks,
  onCenterWeekChange,
  onNotesChange,
  onCreatePublication,
  onMovePublication,
  onDeletePublication,
  onSaveControl,
  onDeleteControl,
  onPreviewStudent,
}: ClassNotebookPanelProps) {
  const [weekDisplayCount, setWeekDisplayCount] = useState<WeekDisplayCount>(3);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [clipboard, setClipboard] = useState<NotebookClipboard | null>(null);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [dragPublicationId, setDragPublicationId] = useState<number | null>(null);
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { publication: string; note: string }>>({});

  const visibleWeeks = useMemo(
    () => visibleSchoolWeeks(schoolWeeks, centerWeekNumber, weekDisplayCount),
    [centerWeekNumber, schoolWeeks, weekDisplayCount],
  );

  const classControls = useMemo(
    () =>
      items
        .filter((item) => item.type === "TEST")
        .sort((left, right) => left.schoolWeekNumber - right.schoolWeekNumber),
    [items],
  );

  const branchLabel = classSetup.branchNames[0] ?? "Branche";

  const handlePaste = useCallback(
    async (targetWeekNumber: number) => {
      if (!clipboard) return;

      if (clipboard.kind === "publication" && clipboard.publicationId) {
        if (clipboard.mode === "cut") {
          await onMovePublication(clipboard.publicationId, targetWeekNumber);
          setClipboard(null);
          return;
        }
        const source = items.find((item) => item.id === clipboard.publicationId);
        if (source) {
          await onCreatePublication(targetWeekNumber, source.title);
        }
        return;
      }

      if (clipboard.kind === "note" && clipboard.noteId && clipboard.noteText) {
        const fromKey = weekNotesKey(classSetup.id, clipboard.sourceWeekNumber);
        const toKey = weekNotesKey(classSetup.id, targetWeekNumber);
        if (clipboard.mode === "cut") {
          onNotesChange(moveWeekNote(notesDocument, fromKey, toKey, clipboard.noteId));
          setClipboard(null);
          return;
        }
        onNotesChange(appendWeekNote(notesDocument, toKey, clipboard.noteText));
      }
    },
    [
      clipboard,
      classSetup.id,
      items,
      notesDocument,
      onCreatePublication,
      onMovePublication,
      onNotesChange,
    ],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!selection) return;
      const key = event.key.toLowerCase();
      const withCommand = event.ctrlKey || event.metaKey;
      if (!withCommand) return;

      if (key === "x") {
        event.preventDefault();
        if (selection.kind === "publication") {
          setClipboard({
            kind: "publication",
            mode: "cut",
            sourceWeekNumber: selection.weekNumber,
            publicationId: selection.itemId,
          });
        } else {
          const noteKey = weekNotesKey(classSetup.id, selection.weekNumber);
          const note = listWeekNotes(notesDocument, noteKey).find((entry) => entry.id === selection.noteId);
          if (note) {
            setClipboard({
              kind: "note",
              mode: "cut",
              sourceWeekNumber: selection.weekNumber,
              noteId: note.id,
              noteText: note.text,
            });
          }
        }
      }

      if (key === "c" && selection.kind === "publication") {
        event.preventDefault();
        setClipboard({
          kind: "publication",
          mode: "copy",
          sourceWeekNumber: selection.weekNumber,
          publicationId: selection.itemId,
        });
      }

      if (key === "v") {
        event.preventDefault();
        void handlePaste(selection.weekNumber);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [classSetup.id, handlePaste, notesDocument, selection]);

  function getDraft(weekNumber: number) {
    return drafts[weekNumber] ?? { publication: "", note: "" };
  }

  function setDraft(weekNumber: number, patch: Partial<{ publication: string; note: string }>) {
    setDrafts((current) => ({
      ...current,
      [weekNumber]: { ...getDraft(weekNumber), ...patch },
    }));
  }

  async function submitPublicationLine(weekNumber: number) {
    const text = getDraft(weekNumber).publication.trim();
    if (!text || !canPublish) return;
    await onCreatePublication(weekNumber, text);
    setDraft(weekNumber, { publication: "" });
  }

  function submitNoteLine(weekNumber: number) {
    const text = getDraft(weekNumber).note.trim();
    if (!text) return;
    const key = weekNotesKey(classSetup.id, weekNumber);
    onNotesChange(appendWeekNote(notesDocument, key, text));
    setDraft(weekNumber, { note: "" });
  }

  function handlePublicationDragStart(event: DragEvent<HTMLLIElement>, itemId: number) {
    setDragPublicationId(itemId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleNoteDragStart(event: DragEvent<HTMLLIElement>, noteId: string) {
    setDragNoteId(noteId);
    event.dataTransfer.effectAllowed = "move";
  }

  async function handleDropOnWeek(event: DragEvent<HTMLElement>, weekNumber: number) {
    event.preventDefault();
    if (dragPublicationId !== null) {
      await onMovePublication(dragPublicationId, weekNumber);
      setDragPublicationId(null);
      return;
    }
    if (dragNoteId) {
      const sourceWeek = visibleWeeks.find((week) => {
        const key = weekNotesKey(classSetup.id, week.number);
        return listWeekNotes(notesDocument, key).some((note) => note.id === dragNoteId);
      });
      if (sourceWeek && sourceWeek.number !== weekNumber) {
        const fromKey = weekNotesKey(classSetup.id, sourceWeek.number);
        const toKey = weekNotesKey(classSetup.id, weekNumber);
        onNotesChange(moveWeekNote(notesDocument, fromKey, toKey, dragNoteId));
      }
      setDragNoteId(null);
    }
  }

  return (
    <section className="teacher-workspace class-notebook" aria-label={`Carnet ${classSetup.name}`}>
      <div className="class-notebook-toolbar">
        <button type="button" className="workspace-action secondary" onClick={onBack}>
          ← Ma semaine
        </button>
        <div className="class-notebook-title">
          <span className="eyebrow">{classSetup.programLabel}</span>
          <h2>{classSetup.name} · {branchLabel}</h2>
        </div>
        <div className="class-notebook-actions">
          <button type="button" className="workspace-action secondary" onClick={() => setControlsOpen(true)}>
            Contrôles 📅
          </button>
          {onPreviewStudent ? (
            <button type="button" className="workspace-action secondary" onClick={onPreviewStudent}>
              Aperçu élève
            </button>
          ) : null}
        </div>
      </div>

      {!canPublish && publishBlockedReason ? (
        <p className="class-notebook-warning">{publishBlockedReason}</p>
      ) : null}

      <div className="class-notebook-week-controls">
        <div className="class-notebook-shift">
          <button type="button" onClick={() => onShiftWeeks(-1)} aria-label="Semaines précédentes">
            ◀
          </button>
          <button type="button" onClick={() => onShiftWeeks(1)} aria-label="Semaines suivantes">
            ▶
          </button>
        </div>
        <fieldset className="class-notebook-display-count">
          <legend>Affichage</legend>
          {([1, 2, 3, 4] as WeekDisplayCount[]).map((count) => (
            <label key={count}>
              <input
                type="radio"
                name="week-display-count"
                checked={weekDisplayCount === count}
                onChange={() => setWeekDisplayCount(clampWeekDisplayCount(count))}
              />
              {count} semaine{count > 1 ? "s" : ""}
            </label>
          ))}
        </fieldset>
      </div>

      <div
        className={`class-notebook-grid class-notebook-grid-${weekDisplayCount}`}
        style={{ gridTemplateColumns: `repeat(${weekDisplayCount}, minmax(0, 1fr))` }}
      >
        {visibleWeeks.map((week) => {
          const weekKey = weekNotesKey(classSetup.id, week.number);
          const weekNotes = listWeekNotes(notesDocument, weekKey);
          const weekControls = classControls.filter((item) => item.schoolWeekNumber === week.number);
          const weekPublications = items.filter(
            (item) => item.schoolWeekNumber === week.number && isPublicationLine(item),
          );
          const draft = getDraft(week.number);
          const isActive = week.number === centerWeekNumber;

          return (
            <article
              key={week.number}
              className={`class-notebook-column${isActive ? " active" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleDropOnWeek(event, week.number)}
            >
              <header className="class-notebook-column-header">
                <button type="button" onClick={() => onCenterWeekChange(week.number)}>
                  <strong>{formatWeekColumnLabel(week)}</strong>
                  <span>{formatWeekColumnSubtitle(week)}</span>
                </button>
              </header>

              <section className="class-notebook-zone class-notebook-zone-control" aria-label="Contrôle">
                <h3>Contrôle</h3>
                {weekControls.length ? (
                  <ul>
                    {weekControls.map((item) => (
                      <li
                        key={item.id}
                        draggable
                        onDragStart={(event) => handlePublicationDragStart(event, item.id)}
                        onClick={() =>
                          setSelection({ kind: "publication", itemId: item.id, weekNumber: week.number })
                        }
                      >
                        <span>📅 {item.title}</span>
                        <small>{item.day === 3 ? "jeudi" : "lundi"}</small>
                        <button
                          type="button"
                          aria-label={`Supprimer le contrôle ${item.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void onDeleteControl(item.id);
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button type="button" className="class-notebook-plan-link" onClick={() => setControlsOpen(true)}>
                    Planifier →
                  </button>
                )}
              </section>

              <section className="class-notebook-zone class-notebook-zone-publication" aria-label="Publication élèves">
                <h3>Publication élèves</h3>
                <ul>
                  {weekPublications.map((item) => (
                    <li
                      key={item.id}
                      draggable={canPublish}
                      onDragStart={(event) => handlePublicationDragStart(event, item.id)}
                      onClick={() =>
                        setSelection({ kind: "publication", itemId: item.id, weekNumber: week.number })
                      }
                      className={selection?.kind === "publication" && selection.itemId === item.id ? "selected" : ""}
                    >
                      <span>{item.title}</span>
                      <button
                        type="button"
                        aria-label={`Supprimer ${item.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onDeletePublication(item.id);
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <input
                  value={draft.publication}
                  disabled={!canPublish}
                  placeholder="Taper + Entrée…"
                  onChange={(event) => setDraft(week.number, { publication: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitPublicationLine(week.number);
                    }
                  }}
                />
              </section>

              <section className="class-notebook-zone class-notebook-zone-notes" aria-label="Notes prof">
                <h3>Notes prof</h3>
                <ul>
                  {weekNotes.map((note) => (
                    <li
                      key={note.id}
                      draggable
                      onDragStart={(event) => handleNoteDragStart(event, note.id)}
                      onClick={() => setSelection({ kind: "note", noteId: note.id, weekNumber: week.number })}
                      className={selection?.kind === "note" && selection.noteId === note.id ? "selected" : ""}
                    >
                      <span>{note.text}</span>
                      <button
                        type="button"
                        aria-label={`Supprimer la note ${note.text}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onNotesChange(removeWeekNote(notesDocument, weekKey, note.id));
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <input
                  value={draft.note}
                  placeholder="Note privée…"
                  onChange={(event) => setDraft(week.number, { note: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitNoteLine(week.number);
                    }
                  }}
                />
              </section>
            </article>
          );
        })}
      </div>

      {clipboard ? (
        <p className="class-notebook-clipboard-hint" role="status">
          Élément en mémoire — sélectionnez une semaine et appuyez sur Ctrl+V, ou glissez-déposez.
        </p>
      ) : null}

      <ControlsModal
        open={controlsOpen}
        classLabel={classSetup.name}
        branchLabel={branchLabel}
        schoolWeeks={schoolWeeks}
        controls={classControls}
        onClose={() => setControlsOpen(false)}
        onSave={onSaveControl}
        onDelete={onDeleteControl}
      />
    </section>
  );
}
