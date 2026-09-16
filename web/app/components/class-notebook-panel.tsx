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
  composeWeekNotesDoc,
  composeWeekPublicationDoc,
  emptyRichDoc,
  formatWeekColumnLabel,
  formatWeekColumnSubtitle,
  isCarnetOwnedPublication,
  isEmptyRichDoc,
  isPublicationLine,
  listWeekNotes,
  moveWeekNote,
  previousSchoolWeekNumber,
  setWeekRichNote,
  weekCarnetVisibility,
  type CampusRichDoc,
  type ClassNotesDocument,
  type NotebookClipboard,
  type WeekDisplayCount,
  weekNotesKey,
  visibleSchoolWeeks,
} from "@campus/features/class-notebook";
import { isStructuredAgendaPublication as isStructuredPublication } from "@campus/features/agenda/publications";
import type { TeacherClassSetup } from "@campus/features/teacher-setup";
import { ControlsModal } from "./controls-modal.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { RichDocEditor } from "./rich-doc-editor.tsx";
import { RichDocView } from "./rich-doc-view.tsx";

interface ClassNotebookPanelProps {
  classSetup: TeacherClassSetup;
  branchLabel?: string | null;
  annualCourseId?: string | null;
  subjectId?: string | null;
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
  onSaveWeekPublication: (schoolWeekNumber: number, doc: CampusRichDoc, options?: { studentVisible?: boolean }) => Promise<void>;
  onCopyPreviousPublication: (schoolWeekNumber: number) => Promise<void>;
  onSetWeekPublicationVisibility: (schoolWeekNumber: number, studentVisible: boolean) => Promise<void>;
  onMovePublication: (itemId: number, schoolWeekNumber: number) => Promise<void>;
  onSaveControl: (input: { schoolWeekNumber: number; day: number; title: string }) => Promise<void>;
  onDeleteControl: (itemId: number) => Promise<void>;
  onPreviewStudent?: () => void;
}

type LineSelection =
  | { kind: "publication"; itemId: number; weekNumber: number }
  | { kind: "note"; noteId: string; weekNumber: number };

type EditorKind = "publication" | "notes";

export function ClassNotebookPanel({
  classSetup,
  branchLabel: selectedBranchLabel,
  annualCourseId,
  subjectId,
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
  onSaveWeekPublication,
  onCopyPreviousPublication,
  onSetWeekPublicationVisibility,
  onMovePublication,
  onSaveControl,
  onDeleteControl,
  onPreviewStudent,
}: ClassNotebookPanelProps) {
  const [weekDisplayCount, setWeekDisplayCount] = useState<WeekDisplayCount>(3);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [clipboard, setClipboard] = useState<NotebookClipboard | null>(null);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [dragPublicationId, setDragPublicationId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ kind: EditorKind; weekNumber: number } | null>(null);
  const [editorDoc, setEditorDoc] = useState<CampusRichDoc>(emptyRichDoc());
  const [studentPreviewOpen, setStudentPreviewOpen] = useState(false);
  const [copyConfirmWeek, setCopyConfirmWeek] = useState<number | null>(null);
  const [unpublishWeek, setUnpublishWeek] = useState<number | null>(null);

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

  const branchLabel = selectedBranchLabel?.trim() || classSetup.branchNames[0] || "Branche";

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

  function openEditor(kind: EditorKind, weekNumber: number) {
    const weekItems = items.filter((item) => item.schoolWeekNumber === weekNumber);
    const weekKey = weekNotesKey(classSetup.id, weekNumber);
    const doc =
      kind === "publication"
        ? composeWeekPublicationDoc(weekItems)
        : composeWeekNotesDoc(listWeekNotes(notesDocument, weekKey));
    setEditorDoc(doc);
    setStudentPreviewOpen(false);
    setEditor({ kind, weekNumber });
  }

  async function saveEditor(studentVisible?: boolean) {
    if (!editor) return;
    if (editor.kind === "publication") {
      if (!canPublish) return;
      await onSaveWeekPublication(
        editor.weekNumber,
        editorDoc,
        studentVisible === undefined ? undefined : { studentVisible },
      );
    } else {
      const key = weekNotesKey(classSetup.id, editor.weekNumber);
      onNotesChange(setWeekRichNote(notesDocument, key, editorDoc));
    }
    setEditor(null);
    setStudentPreviewOpen(false);
  }

  function handlePublicationDragStart(event: DragEvent<HTMLLIElement>, itemId: number) {
    setDragPublicationId(itemId);
    event.dataTransfer.effectAllowed = "move";
  }

  async function handleDropOnWeek(event: DragEvent<HTMLElement>, weekNumber: number) {
    event.preventDefault();
    if (dragPublicationId !== null) {
      await onMovePublication(dragPublicationId, weekNumber);
      setDragPublicationId(null);
    }
  }

  const editorVisibility = editor
    ? weekCarnetVisibility(items.filter((item) => item.schoolWeekNumber === editor.weekNumber))
    : "empty";
  const copySourceWeek =
    copyConfirmWeek != null ? schoolWeeks.find((week) => week.number === previousSchoolWeekNumber(schoolWeeks, copyConfirmWeek)) : undefined;
  const copyTargetWeek = copyConfirmWeek != null ? schoolWeeks.find((week) => week.number === copyConfirmWeek) : undefined;
  const unpublishTargetWeek = unpublishWeek != null ? schoolWeeks.find((week) => week.number === unpublishWeek) : undefined;

  return (
    <section
      className="teacher-workspace class-notebook"
      aria-label={`Carnet ${classSetup.name} · ${branchLabel}`}
      data-annual-course-id={annualCourseId ?? undefined}
      data-subject-id={subjectId ?? undefined}
    >
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
          const weekCarnetPublications = items.filter(
            (item) => item.schoolWeekNumber === week.number && isCarnetOwnedPublication(item),
          );
          const weekStructuredPublications = items.filter(
            (item) =>
              item.schoolWeekNumber === week.number &&
              isPublicationLine(item) &&
              isStructuredPublication(item),
          );
          const isActive = week.number === centerWeekNumber;
          const visibility = weekCarnetVisibility(weekCarnetPublications);
          const previousNumber = previousSchoolWeekNumber(schoolWeeks, week.number);
          const previousWeek = previousNumber != null
            ? schoolWeeks.find((entry) => entry.number === previousNumber)
            : undefined;
          const previousDoc = previousNumber != null
            ? composeWeekPublicationDoc(
                items.filter((item) => item.schoolWeekNumber === previousNumber && isCarnetOwnedPublication(item)),
              )
            : emptyRichDoc();
          const canCopyPrevious = Boolean(canPublish && previousWeek && !isEmptyRichDoc(previousDoc));

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
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelection({ kind: "publication", itemId: item.id, weekNumber: week.number })
                          }
                        >
                          <span>📅 {item.title}</span>
                        </button>
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

              <section
                className={`class-notebook-zone class-notebook-zone-publication${visibility === "draft" ? " is-draft" : ""}${visibility === "published" ? " is-published" : ""}`}
                aria-label="Publication élèves"
              >
                <div className="class-notebook-zone-heading">
                  <h3>Publication élèves</h3>
                  {visibility === "draft" ? (
                    <span className="class-notebook-visibility-badge is-draft">Brouillon</span>
                  ) : null}
                  {visibility === "published" ? (
                    <span className="class-notebook-visibility-badge is-published">Visible aux élèves</span>
                  ) : null}
                </div>
                {visibility === "draft" ? (
                  <p className="class-notebook-visibility-hint">Les élèves ne voient pas encore ce texte.</p>
                ) : null}
                <RichDocView
                  doc={composeWeekPublicationDoc(weekCarnetPublications)}
                  compact
                  emptyLabel="Aucune publication pour cette semaine."
                />
                {weekStructuredPublications.map((item) => (
                  <p key={item.id} className="class-notebook-structured-line">
                    {item.title}
                  </p>
                ))}
                <div className="class-notebook-zone-actions">
                  <button
                    type="button"
                    className="workspace-action secondary"
                    disabled={!canPublish}
                    onClick={() => openEditor("publication", week.number)}
                  >
                    {visibility === "empty" ? "Rédiger" : "Modifier"}
                  </button>
                  {visibility === "draft" && canPublish ? (
                    <button
                      type="button"
                      className="workspace-action"
                      onClick={() => void onSetWeekPublicationVisibility(week.number, true)}
                    >
                      Publier aux élèves
                    </button>
                  ) : null}
                  {visibility === "published" && canPublish ? (
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() => setUnpublishWeek(week.number)}
                    >
                      Repasser en brouillon
                    </button>
                  ) : null}
                  {canCopyPrevious && previousWeek ? (
                    <button
                      type="button"
                      className="class-notebook-quiet-action"
                      onClick={() => setCopyConfirmWeek(week.number)}
                    >
                      Reprendre {formatWeekColumnLabel(previousWeek)}
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="class-notebook-zone class-notebook-zone-notes" aria-label="Notes prof">
                <h3>Notes prof</h3>
                <RichDocView
                  doc={composeWeekNotesDoc(weekNotes)}
                  compact
                  emptyLabel="Aucune note privée."
                />
                <div className="class-notebook-zone-actions">
                  <button
                    type="button"
                    className="workspace-action secondary"
                    onClick={() => openEditor("notes", week.number)}
                  >
                    Modifier
                  </button>
                </div>
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

      {editor ? (
        <div className="rich-doc-overlay" role="dialog" aria-modal="true" aria-label={editor.kind === "publication" ? "Publication élèves" : "Notes prof"}>
          <div className="rich-doc-overlay-card">
            <header>
              <p className="eyebrow">{editor.kind === "publication" ? "Publication élèves" : "Notes prof"}</p>
              <h2>
                {editor.kind === "publication"
                  ? "Rédiger la publication de la semaine"
                  : "Notes privées de la semaine"}
              </h2>
              {editor.kind === "publication" ? (
                <p className="rich-doc-visibility-status">
                  {editorVisibility === "published"
                    ? "Actuellement visible aux élèves. Enregistrer met à jour le texte publié."
                    : "Brouillon — les élèves ne voient pas encore cette semaine."}
                </p>
              ) : null}
            </header>
            {studentPreviewOpen && editor.kind === "publication" ? (
              <div className="rich-doc-student-preview" data-student-preview="">
                <p className="eyebrow">Aperçu élève</p>
                {editorVisibility === "published" ? (
                  <RichDocView doc={editorDoc} emptyLabel="Rien n’est encore publié." />
                ) : (
                  <>
                    <p className="class-notebook-visibility-hint">
                      Les élèves voient une semaine vide tant que vous n’avez pas cliqué sur Publier aux élèves.
                    </p>
                    <p className="eyebrow">Texte prévu</p>
                    <RichDocView doc={editorDoc} emptyLabel="Rien n’est encore rédigé." />
                  </>
                )}
              </div>
            ) : (
              <RichDocEditor
                value={editorDoc}
                variant={editor.kind === "publication" ? "publication" : "notes"}
                onChange={setEditorDoc}
              />
            )}
            <footer className="rich-doc-overlay-actions">
              <button type="button" className="workspace-action" onClick={() => void saveEditor()}>
                Enregistrer
              </button>
              {editor.kind === "publication" && editorVisibility !== "published" ? (
                <button type="button" className="workspace-action" onClick={() => void saveEditor(true)}>
                  Enregistrer et publier
                </button>
              ) : null}
              <button
                type="button"
                className="workspace-action secondary"
                onClick={() => {
                  setEditor(null);
                  setStudentPreviewOpen(false);
                }}
              >
                Annuler
              </button>
              {editor.kind === "publication" ? (
                <button
                  type="button"
                  className="workspace-action secondary"
                  onClick={() => setStudentPreviewOpen((current) => !current)}
                >
                  {studentPreviewOpen ? "Retour à l’édition" : "Aperçu élève"}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={copyConfirmWeek != null && Boolean(copySourceWeek) && Boolean(copyTargetWeek)}
        title={`Reprendre ${copySourceWeek ? formatWeekColumnLabel(copySourceWeek) : "la semaine précédente"}`}
        body={
          copyTargetWeek
            ? `Le texte élèves de ${copySourceWeek ? formatWeekColumnLabel(copySourceWeek) : "la semaine précédente"} remplace celui de ${formatWeekColumnLabel(copyTargetWeek)}. Il reste en brouillon : les élèves ne le voient pas tant que vous n’avez pas cliqué sur Publier aux élèves.`
            : ""
        }
        confirmLabel="Remplacer"
        cancelLabel="Annuler"
        onCancel={() => setCopyConfirmWeek(null)}
        onConfirm={() => {
          if (copyConfirmWeek == null) return;
          const weekNumber = copyConfirmWeek;
          setCopyConfirmWeek(null);
          void onCopyPreviousPublication(weekNumber);
        }}
      />
      <ConfirmDialog
        open={unpublishWeek != null}
        title="Repasser en brouillon"
        body={
          unpublishTargetWeek
            ? `${formatWeekColumnLabel(unpublishTargetWeek)} disparaît de l’agenda élève. Le texte reste dans le Carnet.`
            : "Cette semaine disparaît de l’agenda élève. Le texte reste dans le Carnet."
        }
        confirmLabel="Masquer aux élèves"
        cancelLabel="Annuler"
        onCancel={() => setUnpublishWeek(null)}
        onConfirm={() => {
          if (unpublishWeek == null) return;
          const weekNumber = unpublishWeek;
          setUnpublishWeek(null);
          void onSetWeekPublicationVisibility(weekNumber, false);
        }}
      />
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
