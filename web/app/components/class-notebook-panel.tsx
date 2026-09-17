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
  copyLineToDoc,
  emptyRichDoc,
  formatWeekColumnLabel,
  formatWeekColumnSubtitle,
  isCarnetOwnedPublication,
  isEmptyRichDoc,
  isPublicationLine,
  lineIndexAfterMove,
  listWeekNotes,
  moveLineToDoc,
  moveLineWithinDoc,
  moveWeekNote,
  setWeekRichNote,
  visibleRichDocLines,
  weekCarnetVisibility,
  type CampusRichDoc,
  type ClassNotesDocument,
  type NotebookClipboard,
  type RichDocLine,
  type WeekDisplayCount,
  weekNotesKey,
  visibleSchoolWeeks,
} from "@campus/features/class-notebook";
import { isStructuredAgendaPublication as isStructuredPublication } from "@campus/features/agenda/publications";
import type { TeacherClassSetup } from "@campus/features/teacher-setup";
import { ControlsModal } from "./controls-modal.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { RichDocEditor } from "./rich-doc-editor.tsx";
import { RichDocView, lineViewKey } from "./rich-doc-view.tsx";

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
type LineSource = "publication" | "notes";

type DragPayload =
  | { kind: "week"; itemId: number; weekNumber: number }
  | { kind: "line"; source: LineSource; weekNumber: number; blockIndex: number; itemIndex: number | null };

type SelectedLine = {
  source: LineSource;
  weekNumber: number;
  blockIndex: number;
  itemIndex: number | null;
};

type DeleteTarget = { kind: LineSource; weekNumber: number };

const CARNET_MOVE_PREFIX = "campus-carnet-move:";

function encodeCarnetMove(payload: DragPayload): string {
  return `${CARNET_MOVE_PREFIX}${JSON.stringify(payload)}`;
}

function decodeCarnetMove(raw: string, fallback: DragPayload | null): DragPayload | null {
  if (raw.startsWith(CARNET_MOVE_PREFIX)) {
    try {
      return JSON.parse(raw.slice(CARNET_MOVE_PREFIX.length)) as DragPayload;
    } catch {
      return fallback;
    }
  }
  const itemId = Number(raw);
  if (Number.isFinite(itemId) && itemId > 0) {
    return fallback?.kind === "week" ? fallback : { kind: "week", itemId, weekNumber: fallback?.weekNumber ?? 0 };
  }
  return fallback;
}

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
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [editor, setEditor] = useState<{ kind: EditorKind; weekNumber: number } | null>(null);
  const [editorDoc, setEditorDoc] = useState<CampusRichDoc>(emptyRichDoc());
  const [studentPreviewOpen, setStudentPreviewOpen] = useState(false);
  const [unpublishWeek, setUnpublishWeek] = useState<number | null>(null);
  const [moveMenuWeek, setMoveMenuWeek] = useState<number | null>(null);
  const [selectedLine, setSelectedLine] = useState<SelectedLine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [dropSlot, setDropSlot] = useState<{ source: LineSource; weekNumber: number; atLineIndex: number } | null>(
    null,
  );

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

  const weekSourceDoc = useCallback(
    (source: LineSource, weekNumber: number): CampusRichDoc => {
      if (source === "publication") {
        return composeWeekPublicationDoc(items.filter((item) => item.schoolWeekNumber === weekNumber));
      }
      return composeWeekNotesDoc(listWeekNotes(notesDocument, weekNotesKey(classSetup.id, weekNumber)));
    },
    [classSetup.id, items, notesDocument],
  );

  const rememberLine = useCallback((source: LineSource, weekNumber: number, doc: CampusRichDoc, lineIndex: number) => {
    const line = visibleRichDocLines(doc)[lineIndex];
    if (!line) {
      setSelectedLine(null);
      return;
    }
    setSelectedLine({
      source,
      weekNumber,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
    });
    setClipboard({
      kind: "line",
      mode: "copy",
      sourceWeekNumber: weekNumber,
      lineSource: source,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
    });
  }, []);

  const copyCarnetLine = useCallback(
    async (
      source: LineSource,
      fromWeek: number,
      toWeek: number,
      blockIndex: number,
      itemIndex: number | null,
      atLineIndex?: number,
    ) => {
      if (fromWeek === toWeek) return;
      if (source === "publication") {
        if (!canPublish) return;
        const copied = copyLineToDoc(
          weekSourceDoc(source, fromWeek),
          weekSourceDoc(source, toWeek),
          blockIndex,
          itemIndex,
          atLineIndex,
        );
        if (!copied) return;
        await onSaveWeekPublication(toWeek, copied);
        return;
      }
      const copied = copyLineToDoc(
        weekSourceDoc(source, fromWeek),
        weekSourceDoc(source, toWeek),
        blockIndex,
        itemIndex,
        atLineIndex,
      );
      if (!copied) return;
      onNotesChange(setWeekRichNote(notesDocument, weekNotesKey(classSetup.id, toWeek), copied));
    },
    [canPublish, classSetup.id, notesDocument, onNotesChange, onSaveWeekPublication, weekSourceDoc],
  );

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
        return;
      }

      if (
        clipboard.kind === "line" &&
        clipboard.lineSource &&
        clipboard.blockIndex != null
      ) {
        await copyCarnetLine(
          clipboard.lineSource,
          clipboard.sourceWeekNumber,
          targetWeekNumber,
          clipboard.blockIndex,
          clipboard.itemIndex ?? null,
        );
      }
    },
    [
      clipboard,
      classSetup.id,
      copyCarnetLine,
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
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".rich-doc-editor, input, textarea, [contenteditable='true']")
      ) {
        return;
      }
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

  useEffect(() => {
    if (moveMenuWeek == null) return;
    function close(event: Event) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown") {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".class-notebook-move")) return;
      }
      setMoveMenuWeek(null);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [moveMenuWeek]);

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

  function handlePublicationDragStart(event: DragEvent<HTMLLIElement>, itemId: number, weekNumber: number) {
    const payload: DragPayload = { kind: "week", itemId, weekNumber };
    setDragPayload(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", encodeCarnetMove(payload));
  }

  async function moveCarnetLine(
    source: LineSource,
    fromWeek: number,
    toWeek: number,
    blockIndex: number,
    itemIndex: number | null,
    atLineIndex?: number,
  ) {
    if (source === "publication" && !canPublish) return;
    const fromDoc = weekSourceDoc(source, fromWeek);

    if (fromWeek === toWeek) {
      if (atLineIndex == null) return;
      const fromIndex = visibleRichDocLines(fromDoc).findIndex(
        (line) => line.blockIndex === blockIndex && line.itemIndex === itemIndex,
      );
      const next = moveLineWithinDoc(fromDoc, blockIndex, itemIndex, atLineIndex);
      if (!next || next === fromDoc) return;
      if (source === "publication") {
        await onSaveWeekPublication(toWeek, next);
      } else {
        onNotesChange(setWeekRichNote(notesDocument, weekNotesKey(classSetup.id, toWeek), next));
      }
      if (fromIndex >= 0) {
        rememberLine(source, toWeek, next, lineIndexAfterMove(fromIndex, atLineIndex));
      }
      return;
    }

    const moved = moveLineToDoc(
      fromDoc,
      weekSourceDoc(source, toWeek),
      blockIndex,
      itemIndex,
      atLineIndex,
    );
    if (!moved) return;
    if (source === "publication") {
      await onSaveWeekPublication(toWeek, moved.target);
      await onSaveWeekPublication(fromWeek, moved.source);
    } else {
      const fromKey = weekNotesKey(classSetup.id, fromWeek);
      const toKey = weekNotesKey(classSetup.id, toWeek);
      onNotesChange(setWeekRichNote(setWeekRichNote(notesDocument, fromKey, moved.source), toKey, moved.target));
    }
  }

  async function handleDropOnWeek(event: DragEvent<HTMLElement>, weekNumber: number) {
    event.preventDefault();
    const payload = decodeCarnetMove(event.dataTransfer.getData("text/plain"), dragPayload);
    setDragPayload(null);
    setDropSlot(null);
    if (!payload) return;
    if (payload.kind === "week") {
      if (payload.weekNumber === weekNumber) return;
      const source = items.find((item) => item.id === payload.itemId);
      if (!source || source.schoolWeekNumber === weekNumber) return;
      await onMovePublication(payload.itemId, weekNumber);
      return;
    }
    const atLineIndex = visibleRichDocLines(weekSourceDoc(payload.source, weekNumber)).length;
    await moveCarnetLine(
      payload.source,
      payload.weekNumber,
      weekNumber,
      payload.blockIndex,
      payload.itemIndex,
      atLineIndex,
    );
  }

  function handleDropOnSlot(
    event: DragEvent<HTMLDivElement>,
    source: LineSource,
    weekNumber: number,
    atLineIndex: number,
  ) {
    const payload = decodeCarnetMove(event.dataTransfer.getData("text/plain"), dragPayload);
    setDragPayload(null);
    setDropSlot(null);
    if (!payload || payload.kind !== "line" || payload.source !== source) return;
    void moveCarnetLine(
      payload.source,
      payload.weekNumber,
      weekNumber,
      payload.blockIndex,
      payload.itemIndex,
      atLineIndex,
    );
  }

  function startLineDrag(
    event: DragEvent<HTMLDivElement>,
    source: LineSource,
    weekNumber: number,
    line: RichDocLine,
  ) {
    const payload: DragPayload = {
      kind: "line",
      source,
      weekNumber,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
    };
    setDragPayload(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", encodeCarnetMove(payload));
  }

  function selectAndCopyLine(source: LineSource, weekNumber: number, line: RichDocLine) {
    setSelectedLine({
      source,
      weekNumber,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
    });
    setClipboard({
      kind: "line",
      mode: "copy",
      sourceWeekNumber: weekNumber,
      lineSource: source,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
    });
  }

  function placeCopiedLine(weekNumber: number, source: LineSource, atLineIndex: number) {
    if (!clipboard || clipboard.kind !== "line" || clipboard.lineSource !== source) return;
    if (clipboard.blockIndex == null) return;
    if (clipboard.sourceWeekNumber === weekNumber) {
      void moveCarnetLine(
        clipboard.lineSource,
        clipboard.sourceWeekNumber,
        weekNumber,
        clipboard.blockIndex,
        clipboard.itemIndex ?? null,
        atLineIndex,
      );
      return;
    }
    void copyCarnetLine(
      clipboard.lineSource,
      clipboard.sourceWeekNumber,
      weekNumber,
      clipboard.blockIndex,
      clipboard.itemIndex ?? null,
      atLineIndex,
    );
  }

  function nudgeSelectedLine(source: LineSource, weekNumber: number, line: RichDocLine, direction: -1 | 1) {
    const fromIndex = visibleRichDocLines(weekSourceDoc(source, weekNumber)).findIndex(
      (entry) => entry.blockIndex === line.blockIndex && entry.itemIndex === line.itemIndex,
    );
    if (fromIndex < 0) return;
    const atLineIndex = direction < 0 ? fromIndex - 1 : fromIndex + 2;
    void moveCarnetLine(source, weekNumber, weekNumber, line.blockIndex, line.itemIndex, atLineIndex);
  }

  function lineSlotState(source: LineSource, weekNumber: number, canEdit: boolean) {
    const dragging =
      dragPayload?.kind === "line" && dragPayload.source === source ? dragPayload : null;
    const copied =
      clipboard?.kind === "line" && clipboard.lineSource === source && clipboard.blockIndex != null
        ? clipboard
        : null;
    const showInsertSlots = canEdit && (dragging != null || copied != null);
    const fromThisWeek = dragging
      ? dragging.weekNumber === weekNumber
      : copied?.sourceWeekNumber === weekNumber;
    const origin = dragging
      ? { blockIndex: dragging.blockIndex, itemIndex: dragging.itemIndex }
      : copied
        ? { blockIndex: copied.blockIndex, itemIndex: copied.itemIndex ?? null }
        : null;
    const hiddenInsertSlots = new Set<number>();
    if (showInsertSlots && fromThisWeek && origin) {
      const fromIndex = visibleRichDocLines(weekSourceDoc(source, weekNumber)).findIndex(
        (line) => line.blockIndex === origin.blockIndex && line.itemIndex === origin.itemIndex,
      );
      if (fromIndex >= 0) {
        hiddenInsertSlots.add(fromIndex);
        hiddenInsertSlots.add(fromIndex + 1);
      }
    }
    return {
      showInsertSlots,
      hiddenInsertSlots,
      activeInsertSlot:
        dropSlot?.source === source && dropSlot.weekNumber === weekNumber ? dropSlot.atLineIndex : null,
    };
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { kind, weekNumber } = deleteTarget;
    setDeleteTarget(null);
    if (kind === "publication") {
      if (!canPublish) return;
      await onSaveWeekPublication(weekNumber, emptyRichDoc());
      return;
    }
    onNotesChange(setWeekRichNote(notesDocument, weekNotesKey(classSetup.id, weekNumber), emptyRichDoc()));
  }

  const editorVisibility = editor
    ? weekCarnetVisibility(items.filter((item) => item.schoolWeekNumber === editor.weekNumber))
    : "empty";
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
          const publicationSlots = lineSlotState("publication", week.number, canPublish);
          const notesSlots = lineSlotState("notes", week.number, true);
          const lineDropActive =
            (dragPayload?.kind === "line" && dragPayload.weekNumber !== week.number) ||
            (clipboard?.kind === "line" && clipboard.sourceWeekNumber !== week.number);

          return (
            <article
              key={week.number}
              className={`class-notebook-column${isActive ? " active" : ""}${
                (dragPayload !== null && dragPayload.kind === "week" && dragPayload.weekNumber !== week.number) ||
                lineDropActive
                  ? " is-drop-target"
                  : ""
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
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
                        onDragStart={(event) => handlePublicationDragStart(event, item.id, week.number)}
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
                  {weekCarnetPublications[0] && canPublish ? (
                    <div className="class-notebook-move">
                      <button
                        type="button"
                        className="class-notebook-drag-handle"
                        draggable
                        aria-label={`Déplacer la publication de ${formatWeekColumnLabel(week)}`}
                        aria-expanded={moveMenuWeek === week.number}
                        title="Glisser, ou cliquer pour choisir la semaine"
                        onDragStart={(event) => {
                          const itemId = weekCarnetPublications[0]!.id;
                          const payload: DragPayload = { kind: "week", itemId, weekNumber: week.number };
                          setDragPayload(payload);
                          event.dataTransfer.effectAllowed = "move";
                          // Chrome annule un drag sans données : l'identifiant sert aussi de repli au drop.
                          event.dataTransfer.setData("text/plain", encodeCarnetMove(payload));
                        }}
                        onDragEnd={() => {
                          setDragPayload(null);
                          setDropSlot(null);
                        }}
                        onClick={() =>
                          setMoveMenuWeek((current) => (current === week.number ? null : week.number))
                        }
                      >
                        ⠿
                      </button>
                      {moveMenuWeek === week.number ? (
                        <menu className="class-notebook-move-menu">
                          <li className="class-notebook-move-menu-title">Déplacer vers</li>
                          {schoolWeeks
                            .filter((entry) => entry.number !== week.number)
                            .map((entry) => (
                              <li key={entry.number}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoveMenuWeek(null);
                                    void onMovePublication(weekCarnetPublications[0]!.id, entry.number);
                                  }}
                                >
                                  {formatWeekColumnLabel(entry)}
                                </button>
                              </li>
                            ))}
                        </menu>
                      ) : null}
                    </div>
                  ) : null}
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
                <div className="class-notebook-lines">
                  <RichDocView
                    doc={composeWeekPublicationDoc(weekCarnetPublications)}
                    compact
                    interactive={canPublish}
                    lineDraggable={canPublish}
                    selectedLineKey={
                      selectedLine?.source === "publication" && selectedLine.weekNumber === week.number
                        ? lineViewKey(selectedLine)
                        : undefined
                    }
                    showInsertSlots={publicationSlots.showInsertSlots}
                    activeInsertSlot={publicationSlots.activeInsertSlot}
                    hiddenInsertSlots={publicationSlots.hiddenInsertSlots}
                    emptyLabel="Aucune publication pour cette semaine."
                    onLineClick={
                      canPublish
                        ? (line) => selectAndCopyLine("publication", week.number, line)
                        : undefined
                    }
                    onLineDragStart={
                      canPublish
                        ? (line, event) => startLineDrag(event, "publication", week.number, line)
                        : undefined
                    }
                    onLineDragEnd={() => {
                      setDragPayload(null);
                      setDropSlot(null);
                    }}
                    onInsertSlot={
                      canPublish ? (at) => placeCopiedLine(week.number, "publication", at) : undefined
                    }
                    onInsertSlotDragOver={
                      canPublish
                        ? (at) => setDropSlot({ source: "publication", weekNumber: week.number, atLineIndex: at })
                        : undefined
                    }
                    onInsertSlotDrop={
                      canPublish
                        ? (at, event) => handleDropOnSlot(event, "publication", week.number, at)
                        : undefined
                    }
                    onMoveLine={
                      canPublish
                        ? (line, direction) => nudgeSelectedLine("publication", week.number, line, direction)
                        : undefined
                    }
                  />
                </div>
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
                  {visibility !== "empty" && canPublish ? (
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() => setDeleteTarget({ kind: "publication", weekNumber: week.number })}
                    >
                      Supprimer
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="class-notebook-zone class-notebook-zone-notes" aria-label="Notes prof">
                <h3>Notes prof</h3>
                <div className="class-notebook-lines">
                  <RichDocView
                    doc={composeWeekNotesDoc(weekNotes)}
                    compact
                    interactive
                    lineDraggable
                    selectedLineKey={
                      selectedLine?.source === "notes" && selectedLine.weekNumber === week.number
                        ? lineViewKey(selectedLine)
                        : undefined
                    }
                    showInsertSlots={notesSlots.showInsertSlots}
                    activeInsertSlot={notesSlots.activeInsertSlot}
                    hiddenInsertSlots={notesSlots.hiddenInsertSlots}
                    emptyLabel="Aucune note privée."
                    onLineClick={(line) => selectAndCopyLine("notes", week.number, line)}
                    onLineDragStart={(line, event) => startLineDrag(event, "notes", week.number, line)}
                    onLineDragEnd={() => {
                      setDragPayload(null);
                      setDropSlot(null);
                    }}
                    onInsertSlot={(at) => placeCopiedLine(week.number, "notes", at)}
                    onInsertSlotDragOver={(at) =>
                      setDropSlot({ source: "notes", weekNumber: week.number, atLineIndex: at })
                    }
                    onInsertSlotDrop={(at, event) => handleDropOnSlot(event, "notes", week.number, at)}
                    onMoveLine={(line, direction) => nudgeSelectedLine("notes", week.number, line, direction)}
                  />
                </div>
                <div className="class-notebook-zone-actions">
                  <button
                    type="button"
                    className="workspace-action secondary"
                    onClick={() => openEditor("notes", week.number)}
                  >
                    Modifier
                  </button>
                  {!isEmptyRichDoc(composeWeekNotesDoc(weekNotes)) ? (
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() => setDeleteTarget({ kind: "notes", weekNumber: week.number })}
                    >
                      Supprimer
                    </button>
                  ) : null}
                </div>
              </section>
            </article>
          );
        })}
      </div>

      {clipboard ? (
        <p className="class-notebook-clipboard-hint" role="status">
          {clipboard.kind === "line"
            ? "Ligne sélectionnée — touchez une barre pour l’insérer, utilisez ↑ ↓, ou glissez-la."
            : "Élément en mémoire — sélectionnez une semaine et appuyez sur Ctrl+V, ou glissez-déposez."}
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
      <ConfirmDialog
        open={deleteTarget != null}
        title={deleteTarget?.kind === "notes" ? "Supprimer les notes" : "Supprimer la publication"}
        body={
          deleteTarget?.kind === "notes"
            ? "Toutes les notes privées de cette semaine seront effacées. Cette action ne peut pas être annulée."
            : "Tout le texte de cette semaine sera effacé. Cette action ne peut pas être annulée."
        }
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
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
