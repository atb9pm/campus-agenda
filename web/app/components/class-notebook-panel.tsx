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
  assignOrphanedSessionNotes,
  assignPendingWeekNotes,
  clampWeekDisplayCount,
  NOTEBOOK_NARROW_VIEWPORT_MAX_PX,
  notebookWeekDisplayCountForViewport,
  composeWeekNotesDoc,
  composeWeekPublicationDoc,
  copyWeekUnitToDoc,
  deleteWeekUnit,
  emptyRichDoc,
  eligibleCourseWeekNumbers,
  eligibleSchoolWeeksForSessions,
  extractWeekUnit,
  insertWeekUnitAt,
  adjacentWeekUnitInsertIndex,
  findCarnetPublicationItemForSave,
  formatCourseSessionCardSubtitle,
  formatCourseSessionCardWeekLabel,
  formatWeekColumnLabel,
  formatWeekColumnSubtitle,
  isCarnetOwnedPublication,
  isListBlock,
  listBlockLineSpan,
  courseSessionForControlSlot,
  isEmptyRichDoc,
  isPublicationLine,
  itemsForCourseSession,
  lineIndexAfterMove,
  listPendingWeekNotes,
  listSessionNotes,
  listWeekNotes,
  migrateClassNotesToSessions,
  moveTargetCourseSessions,
  moveWeekUnitToDoc,
  moveWeekUnitWithinDoc,
  moveTargetSchoolWeeks,
  moveWeekNote,
  notesDocumentsEquivalent,
  orphanedSessionNotesForCourse,
  orderedCourseSessions,
  pendingWeekNotesWithoutSession,
  rememberRichClip,
  schoolWeekForSession,
  sessionNotesKey,
  setSessionRichNote,
  setWeekRichNote,
  shiftCourseSession,
  snapToCourseSession,
  snapToEligibleCourseWeek,
  visibleCourseSessions,
  visibleCourseWeeks,
  visibleRichDocLines,
  weekCarnetVisibility,
  weekdayLabelForCourseDayIndex,
  formatControlSessionDayLabel,
  type CampusRichDoc,
  type ClassNotesDocument,
  type NotebookClipboard,
  type RichDocLine,
  type WeekDisplayCount,
  weekNotesKey,
  visibleSchoolWeeks,
} from "@campus/features/class-notebook";
import { formatCourseSessionPeriods, type CourseSession } from "@campus/features/course-sessions";
import {
  classDayControlsForPlacementOption,
  confirmationRequiredForPlacementOption,
} from "@campus/features/control-planning";
import type { ControlCoordinationSummary } from "@campus/features/evaluations";
import { isStructuredAgendaPublication as isStructuredPublication } from "@campus/features/agenda/publications";
import type { TeacherClassSetup } from "@campus/features/teacher-setup";
import {
  ControlCoordinationRequiredError,
  fetchTeacherControlPlanningApi,
  fetchTeacherCourseTimelineApi,
} from "../../lib/api-client.ts";
import {
  ControlEditorModal,
  controlEditorDetailValue,
  formatControlEditorCourseCaption,
  formatControlEditorDateLabel,
  type ControlCoordinationLine,
} from "./control-editor-modal.tsx";
import { ControlsModal } from "./controls-modal.tsx";
import { NotebookExportModal } from "./notebook-export-modal.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { RichDocEditor } from "./rich-doc-editor.tsx";
import { RichDocView, lineViewKey } from "./rich-doc-view.tsx";

interface ClassNotebookPanelProps {
  classSetup: TeacherClassSetup;
  branchLabel?: string | null;
  annualCourseId?: string | null;
  schoolYearLabel?: string | null;
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
  onCreatePublication: (
    schoolWeekNumber: number,
    text: string,
    day?: number,
    session?: { key: string; date: string; schoolWeekNumber: number; dayOfWeek: number },
  ) => Promise<void>;
  onSaveWeekPublication: (
    schoolWeekNumber: number,
    doc: CampusRichDoc,
    options?: { studentVisible?: boolean; day?: number; courseSessionKey?: string; courseSessionDate?: string },
  ) => Promise<void>;
  onSetWeekPublicationVisibility: (
    schoolWeekNumber: number,
    studentVisible: boolean,
    sessionKey?: string,
  ) => Promise<void>;
  onMovePublication: (
    itemId: number,
    schoolWeekNumber: number,
    day?: number,
    session?: { key: string; date: string; schoolWeekNumber: number; dayOfWeek: number },
  ) => Promise<void>;
  classroomId?: string | null;
  /** AnnualCourse de la classe (attribution V1 uniquement si la liste a un seul cours). */
  classAnnualCourseIds?: readonly string[];
  onSaveControl: (input: {
    schoolWeekNumber: number;
    day: number;
    title: string;
    detail?: string;
    courseSessionKey?: string;
    annualCourseId?: string;
    confirmCoordination?: boolean;
  }) => Promise<void>;
  onUpdateControl: (itemId: number, input: { title: string; detail: string }) => Promise<void>;
  onDeleteControl: (itemId: number) => Promise<void>;
  onPreviewStudent?: () => void;
}

type LineSelection =
  | { kind: "publication"; itemId: number; weekNumber: number; sessionKey?: string }
  | { kind: "note"; noteId: string; weekNumber: number; sessionKey?: string };

type EditorKind = "publication" | "notes";
type LineSource = "publication" | "notes";

type DragPayload =
  | { kind: "week"; itemId: number; weekNumber: number; sessionKey?: string }
  | { kind: "line"; source: LineSource; weekNumber: number; blockIndex: number; itemIndex: number | null; sessionKey?: string };

type SelectedLine = {
  source: LineSource;
  weekNumber: number;
  blockIndex: number;
  itemIndex: number | null;
  sessionKey?: string;
};

type DeleteTarget = { kind: LineSource; weekNumber: number; cardId: string };

type NotebookCard = {
  id: string;
  weekNumber: number;
  week: SchoolWeek | null;
  session: CourseSession | null;
};

function sessionPlacement(session: CourseSession) {
  return {
    key: session.key,
    date: session.date,
    schoolWeekNumber: session.schoolWeekNumber,
    dayOfWeek: session.dayOfWeek,
  };
}

const CARNET_MOVE_PREFIX = "campus-carnet-move:";
const NOTEBOOK_NARROW_MEDIA = `(max-width: ${NOTEBOOK_NARROW_VIEWPORT_MAX_PX}px)`;

function useNotebookNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(NOTEBOOK_NARROW_MEDIA);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return narrow;
}

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
  schoolYearLabel,
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
  onCreatePublication: persistCreatePublication,
  onSaveWeekPublication: persistSaveWeekPublication,
  onSetWeekPublicationVisibility,
  onMovePublication: persistMovePublication,
  classroomId = null,
  classAnnualCourseIds = [],
  onSaveControl,
  onUpdateControl,
  onDeleteControl,
  onPreviewStudent,
}: ClassNotebookPanelProps) {
  const [weekDisplayCount, setWeekDisplayCount] = useState<WeekDisplayCount>(3);
  const narrowViewport = useNotebookNarrowViewport();
  const effectiveWeekDisplayCount = notebookWeekDisplayCountForViewport(
    narrowViewport ? NOTEBOOK_NARROW_VIEWPORT_MAX_PX : NOTEBOOK_NARROW_VIEWPORT_MAX_PX + 1,
    weekDisplayCount,
  );
  const [controlsOpen, setControlsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [clipboard, setClipboard] = useState<NotebookClipboard | null>(null);
  const [selection] = useState<LineSelection | null>(null);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [editor, setEditor] = useState<{ kind: EditorKind; weekNumber: number; sessionKey?: string | null } | null>(null);
  const [editorDoc, setEditorDoc] = useState<CampusRichDoc>(emptyRichDoc());
  const [studentPreviewOpen, setStudentPreviewOpen] = useState(false);
  const [unpublishCardId, setUnpublishCardId] = useState<string | null>(null);
  const [moveMenuCardId, setMoveMenuCardId] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<SelectedLine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [dropSlot, setDropSlot] = useState<{
    source: LineSource;
    weekNumber: number;
    atLineIndex: number;
    sessionKey?: string;
    cardId?: string;
  } | null>(null);
  const [courseSessions, setCourseSessions] = useState<CourseSession[] | null>(null);
  const [loadedCourseId, setLoadedCourseId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState("");
  const [centerSessionKey, setCenterSessionKey] = useState<string | null>(null);
  const [controlEditor, setControlEditor] = useState<
    | { mode: "create"; session: CourseSession }
    | { mode: "edit"; item: PrototypeAgendaItem; session: CourseSession | null }
    | null
  >(null);
  const [controlTitle, setControlTitle] = useState("");
  const [controlDetail, setControlDetail] = useState("");
  const [controlSubmitting, setControlSubmitting] = useState(false);
  const [controlError, setControlError] = useState("");
  const [controlServerCoordination, setControlServerCoordination] = useState<ControlCoordinationSummary | null>(null);
  const [controlPreviewDay, setControlPreviewDay] = useState<ControlCoordinationLine[]>([]);
  const [controlPreviewWeek, setControlPreviewWeek] = useState<ControlCoordinationLine[]>([]);
  const [controlPreviewConfirm, setControlPreviewConfirm] = useState(false);

  const structuredCourseId = annualCourseId?.trim() || "";
  const structuredCourse = Boolean(structuredCourseId);
  const sessionsLoading = structuredCourse && loadedCourseId !== structuredCourseId;

  useEffect(() => {
    const courseId = annualCourseId?.trim() || "";
    if (!courseId) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await fetchTeacherCourseTimelineApi(courseId, controller.signal);
        if (controller.signal.aborted) return;
        const sessions = payload.timeline.entries.map((entry) => entry.courseSession);
        setCourseSessions(sessions);
        setLoadedCourseId(courseId);
        setSessionsError("");
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof Error && caught.name === "AbortError") return;
        setSessionsError(caught instanceof Error ? caught.message : "Chargement des séances impossible.");
        setCourseSessions([]);
        setLoadedCourseId(courseId);
      }
    })();

    return () => controller.abort();
  }, [annualCourseId]);

  const eligibleWeeks = useMemo(() => {
    if (!structuredCourse || sessionsLoading || courseSessions == null) return schoolWeeks;
    return eligibleSchoolWeeksForSessions(schoolWeeks, courseSessions);
  }, [courseSessions, schoolWeeks, sessionsLoading, structuredCourse]);

  const eligibleWeekNumbers = useMemo(
    () =>
      structuredCourse && !sessionsLoading && courseSessions
        ? eligibleCourseWeekNumbers(courseSessions)
        : schoolWeeks.map((week) => week.number),
    [courseSessions, schoolWeeks, sessionsLoading, structuredCourse],
  );

  const orderedSessions = useMemo(
    () => (courseSessions ? orderedCourseSessions(courseSessions) : []),
    [courseSessions],
  );

  const displayStartSession = useMemo(() => {
    if (!structuredCourse || sessionsLoading || !orderedSessions.length) return null;
    return snapToCourseSession(orderedSessions, centerSessionKey, centerWeekNumber);
  }, [centerSessionKey, centerWeekNumber, orderedSessions, sessionsLoading, structuredCourse]);

  const displayStartWeek =
    structuredCourse && displayStartSession
      ? displayStartSession.schoolWeekNumber
      : structuredCourse && !sessionsLoading && eligibleWeekNumbers.length
        ? eligibleWeekNumbers.includes(centerWeekNumber)
          ? centerWeekNumber
          : (snapToEligibleCourseWeek(eligibleWeekNumbers, centerWeekNumber) ?? centerWeekNumber)
        : centerWeekNumber;

  useEffect(() => {
    if (!structuredCourse || sessionsLoading || courseSessions == null || sessionsError) return;
    const migrated = migrateClassNotesToSessions(notesDocument, courseSessions, classSetup.id, {
      annualCourseId: structuredCourseId,
      classAnnualCourseIds,
    });
    if (migrated.changed && !notesDocumentsEquivalent(notesDocument, migrated.document)) {
      onNotesChange(migrated.document);
    }
  }, [
    classAnnualCourseIds,
    classSetup.id,
    courseSessions,
    notesDocument,
    onNotesChange,
    sessionsError,
    sessionsLoading,
    structuredCourse,
    structuredCourseId,
  ]);

  const visibleWeeks = useMemo(() => {
    if (structuredCourse) {
      if (sessionsLoading || courseSessions == null) return [];
      return visibleCourseWeeks(eligibleWeeks, displayStartWeek, effectiveWeekDisplayCount);
    }
    return visibleSchoolWeeks(schoolWeeks, centerWeekNumber, effectiveWeekDisplayCount);
  }, [
    centerWeekNumber,
    courseSessions,
    displayStartWeek,
    effectiveWeekDisplayCount,
    eligibleWeeks,
    schoolWeeks,
    sessionsLoading,
    structuredCourse,
  ]);

  const visibleCards: NotebookCard[] = useMemo(() => {
    if (structuredCourse) {
      if (sessionsLoading || !orderedSessions.length) return [];
      return visibleCourseSessions(
        orderedSessions,
        displayStartSession?.key ?? null,
        effectiveWeekDisplayCount,
      ).map((session) => ({
        id: session.key,
        weekNumber: session.schoolWeekNumber,
        week: schoolWeekForSession(schoolWeeks, session),
        session,
      }));
    }
    return visibleWeeks.map((week) => ({
      id: `week:${week.number}`,
      weekNumber: week.number,
      week,
      session: null,
    }));
  }, [
    displayStartSession?.key,
    effectiveWeekDisplayCount,
    orderedSessions,
    schoolWeeks,
    sessionsLoading,
    structuredCourse,
    visibleWeeks,
  ]);

  const allCards: NotebookCard[] = useMemo(() => {
    if (structuredCourse) {
      return orderedSessions.map((session) => ({
        id: session.key,
        weekNumber: session.schoolWeekNumber,
        week: schoolWeekForSession(schoolWeeks, session),
        session,
      }));
    }
    return schoolWeeks.map((week) => ({
      id: `week:${week.number}`,
      weekNumber: week.number,
      week,
      session: null,
    }));
  }, [orderedSessions, schoolWeeks, structuredCourse]);

  function cardById(cardId: string): NotebookCard | undefined {
    return allCards.find((card) => card.id === cardId) ?? visibleCards.find((card) => card.id === cardId);
  }

  function shiftVisibleWeeks(direction: -1 | 1) {
    if (structuredCourse) {
      const next = shiftCourseSession(orderedSessions, displayStartSession?.key ?? null, direction);
      if (!next) return;
      setCenterSessionKey(next.key);
      onCenterWeekChange(next.schoolWeekNumber);
      return;
    }
    onShiftWeeks(direction);
  }

  const onCreatePublication = useCallback(
    (schoolWeekNumber: number, text: string, session?: CourseSession | null) => {
      return persistCreatePublication(
        schoolWeekNumber,
        text,
        session ? session.dayOfWeek - 1 : undefined,
        session ? sessionPlacement(session) : undefined,
      );
    },
    [persistCreatePublication],
  );

  const onSaveWeekPublication = useCallback(
    (schoolWeekNumber: number, doc: CampusRichDoc, options?: { studentVisible?: boolean; session?: CourseSession | null }) => {
      const session = options?.session ?? null;
      const weekItems = session && courseSessions
        ? itemsForCourseSession(items, session, courseSessions).filter(isCarnetOwnedPublication)
        : items.filter((item) => item.schoolWeekNumber === schoolWeekNumber);
      const existing = findCarnetPublicationItemForSave(weekItems);
      return persistSaveWeekPublication(schoolWeekNumber, doc, {
        studentVisible: options?.studentVisible,
        day: session ? session.dayOfWeek - 1 : existing?.day,
        courseSessionKey: session?.key,
        courseSessionDate: session?.date,
      });
    },
    [courseSessions, items, persistSaveWeekPublication],
  );

  const onMovePublication = useCallback(
    (itemId: number, schoolWeekNumber: number, session?: CourseSession | null) => {
      return persistMovePublication(
        itemId,
        session?.schoolWeekNumber ?? schoolWeekNumber,
        session ? session.dayOfWeek - 1 : undefined,
        session ? sessionPlacement(session) : undefined,
      );
    },
    [persistMovePublication],
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
    (source: LineSource, weekNumber: number, session?: CourseSession | null): CampusRichDoc => {
      if (source === "publication") {
        const pubs =
          session && courseSessions
            ? itemsForCourseSession(items, session, courseSessions)
            : items.filter((item) => item.schoolWeekNumber === weekNumber);
        return composeWeekPublicationDoc(pubs);
      }
      if (session) {
        return composeWeekNotesDoc(listSessionNotes(notesDocument, sessionNotesKey(session.key)));
      }
      return composeWeekNotesDoc(listWeekNotes(notesDocument, weekNotesKey(classSetup.id, weekNumber)));
    },
    [classSetup.id, courseSessions, items, notesDocument],
  );

  const saveSourceDoc = useCallback(
    async (source: LineSource, weekNumber: number, doc: CampusRichDoc, session?: CourseSession | null) => {
      if (source === "publication") {
        if (!canPublish) return false;
        await onSaveWeekPublication(weekNumber, doc, { session });
        return true;
      }
      if (session) {
        onNotesChange(setSessionRichNote(notesDocument, sessionNotesKey(session.key), doc));
        return true;
      }
      onNotesChange(setWeekRichNote(notesDocument, weekNotesKey(classSetup.id, weekNumber), doc));
      return true;
    },
    [canPublish, classSetup.id, notesDocument, onNotesChange, onSaveWeekPublication],
  );

  const rememberLine = useCallback((
    source: LineSource,
    weekNumber: number,
    doc: CampusRichDoc,
    lineIndex: number,
    session?: CourseSession | null,
  ) => {
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
      sessionKey: session?.key,
    });
    const extracted = extractWeekUnit(doc, line.blockIndex, line.itemIndex);
    if (extracted) rememberRichClip({ kind: "block", block: extracted.extracted });
    setClipboard({
      kind: "line",
      mode: "copy",
      sourceWeekNumber: weekNumber,
      sourceSessionKey: session?.key,
      lineSource: source,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
      block: extracted?.extracted,
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
      fromSession?: CourseSession | null,
      toSession?: CourseSession | null,
    ) => {
      if (source === "publication") {
        if (!canPublish) return;
        const copied = copyWeekUnitToDoc(
          weekSourceDoc(source, fromWeek, fromSession),
          weekSourceDoc(source, toWeek, toSession),
          blockIndex,
          itemIndex,
          atLineIndex,
        );
        if (!copied) return;
        await onSaveWeekPublication(toWeek, copied, { session: toSession });
        return;
      }
      const copied = copyWeekUnitToDoc(
        weekSourceDoc(source, fromWeek, fromSession),
        weekSourceDoc(source, toWeek, toSession),
        blockIndex,
        itemIndex,
        atLineIndex,
      );
      if (!copied) return;
      if (toSession) {
        onNotesChange(setSessionRichNote(notesDocument, sessionNotesKey(toSession.key), copied));
        return;
      }
      onNotesChange(setWeekRichNote(notesDocument, weekNotesKey(classSetup.id, toWeek), copied));
    },
    [canPublish, classSetup.id, notesDocument, onNotesChange, onSaveWeekPublication, weekSourceDoc],
  );

  const deleteCarnetLine = useCallback(
    async (
      source: LineSource,
      weekNumber: number,
      blockIndex: number,
      itemIndex: number | null,
      session?: CourseSession | null,
    ) => {
      if (source === "publication" && !canPublish) return;
      const result = deleteWeekUnit(weekSourceDoc(source, weekNumber, session), blockIndex, itemIndex);
      if (!result) return;
      await saveSourceDoc(source, weekNumber, result.doc, session);
      setSelectedLine((current) =>
        current?.source === source &&
        current.weekNumber === weekNumber &&
        current.sessionKey === session?.key &&
        current.blockIndex === blockIndex &&
        current.itemIndex === itemIndex
          ? null
          : current,
      );
    },
    [canPublish, saveSourceDoc, weekSourceDoc],
  );

  const cutCarnetLine = useCallback(
    async (
      source: LineSource,
      weekNumber: number,
      blockIndex: number,
      itemIndex: number | null,
      session?: CourseSession | null,
    ) => {
      if (source === "publication" && !canPublish) return;
      const extracted = extractWeekUnit(weekSourceDoc(source, weekNumber, session), blockIndex, itemIndex);
      if (!extracted) return;
      rememberRichClip({ kind: "block", block: extracted.extracted });
      setClipboard({
        kind: "line",
        mode: "cut",
        sourceWeekNumber: weekNumber,
        sourceSessionKey: session?.key,
        lineSource: source,
        blockIndex,
        itemIndex,
        block: extracted.extracted,
      });
      await saveSourceDoc(source, weekNumber, extracted.remaining, session);
      setSelectedLine(null);
    },
    [canPublish, saveSourceDoc, weekSourceDoc],
  );

  const handlePaste = useCallback(
    async (targetWeekNumber: number, session?: CourseSession | null) => {
      if (!clipboard) return;
      const fromSession = clipboard.sourceSessionKey
        ? orderedSessions.find((entry) => entry.key === clipboard.sourceSessionKey) ?? null
        : null;

      if (clipboard.kind === "publication" && clipboard.publicationId) {
        if (clipboard.mode === "cut") {
          await onMovePublication(clipboard.publicationId, targetWeekNumber, session);
          setClipboard(null);
          return;
        }
        const source = items.find((item) => item.id === clipboard.publicationId);
        if (source) {
          await onCreatePublication(targetWeekNumber, source.title, session);
        }
        return;
      }

      if (clipboard.kind === "note" && clipboard.noteId && clipboard.noteText) {
        const fromKey = clipboard.sourceSessionKey || weekNotesKey(classSetup.id, clipboard.sourceWeekNumber);
        const toKey = session ? sessionNotesKey(session.key) : weekNotesKey(classSetup.id, targetWeekNumber);
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
        (clipboard.block || clipboard.blockIndex != null)
      ) {
        const source = clipboard.lineSource;
        const sameCard = session
          ? clipboard.sourceSessionKey === session.key
          : clipboard.sourceWeekNumber === targetWeekNumber && !clipboard.sourceSessionKey;
        if (clipboard.block) {
          const target = weekSourceDoc(source, targetWeekNumber, session);
          let at = visibleRichDocLines(target).length;
          if (clipboard.mode === "copy" && sameCard) {
            const from = visibleRichDocLines(target).findIndex(
              (line) =>
                line.blockIndex === clipboard.blockIndex &&
                line.itemIndex === (clipboard.itemIndex ?? null),
            );
            if (from >= 0) at = from + 1;
          }
          await saveSourceDoc(source, targetWeekNumber, insertWeekUnitAt(target, clipboard.block, at), session);
          if (clipboard.mode === "cut") {
            setClipboard({ ...clipboard, mode: "copy" });
          }
          return;
        }
        if (sameCard) {
          const doc = weekSourceDoc(source, targetWeekNumber, session);
          const from = visibleRichDocLines(doc).findIndex(
            (line) =>
              line.blockIndex === clipboard.blockIndex &&
              line.itemIndex === (clipboard.itemIndex ?? null),
          );
          const copied = copyWeekUnitToDoc(
            doc,
            doc,
            clipboard.blockIndex!,
            clipboard.itemIndex ?? null,
            from < 0 ? undefined : from + 1,
          );
          if (!copied) return;
          await saveSourceDoc(source, targetWeekNumber, copied, session);
          return;
        }
        await copyCarnetLine(
          clipboard.lineSource,
          clipboard.sourceWeekNumber,
          targetWeekNumber,
          clipboard.blockIndex!,
          clipboard.itemIndex ?? null,
          undefined,
          fromSession,
          session,
        );
      }
    },
    [
      classSetup.id,
      clipboard,
      copyCarnetLine,
      items,
      notesDocument,
      onCreatePublication,
      onMovePublication,
      onNotesChange,
      orderedSessions,
      saveSourceDoc,
      weekSourceDoc,
    ],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (editor) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".rich-doc-editor, input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const withCommand = event.ctrlKey || event.metaKey;

      if (!withCommand && (key === "delete" || key === "backspace") && selectedLine) {
        event.preventDefault();
        void deleteCarnetLine(
          selectedLine.source,
          selectedLine.weekNumber,
          selectedLine.blockIndex,
          selectedLine.itemIndex,
          orderedSessions.find((entry) => entry.key === selectedLine.sessionKey) ?? null,
        );
        return;
      }

      if (!withCommand) return;

      if (key === "x") {
        if (selectedLine) {
          event.preventDefault();
          void cutCarnetLine(
            selectedLine.source,
            selectedLine.weekNumber,
            selectedLine.blockIndex,
            selectedLine.itemIndex,
            orderedSessions.find((entry) => entry.key === selectedLine.sessionKey) ?? null,
          );
          return;
        }
        if (!selection) return;
        event.preventDefault();
        if (selection.kind === "publication") {
          setClipboard({
            kind: "publication",
            mode: "cut",
            sourceWeekNumber: selection.weekNumber,
            sourceSessionKey: selection.sessionKey,
            publicationId: selection.itemId,
          });
        } else {
          const noteKey = selection.sessionKey || weekNotesKey(classSetup.id, selection.weekNumber);
          const note = (
            selection.sessionKey
              ? listSessionNotes(notesDocument, selection.sessionKey)
              : listWeekNotes(notesDocument, noteKey)
          ).find((entry) => entry.id === selection.noteId);
          if (note) {
            setClipboard({
              kind: "note",
              mode: "cut",
              sourceWeekNumber: selection.weekNumber,
              sourceSessionKey: selection.sessionKey,
              noteId: note.id,
              noteText: note.text,
            });
          }
        }
        return;
      }

      if (key === "c") {
        if (selectedLine) {
          event.preventDefault();
          const extracted = extractWeekUnit(
            weekSourceDoc(
              selectedLine.source,
              selectedLine.weekNumber,
              orderedSessions.find((entry) => entry.key === selectedLine.sessionKey) ?? null,
            ),
            selectedLine.blockIndex,
            selectedLine.itemIndex,
          );
          if (extracted) rememberRichClip({ kind: "block", block: extracted.extracted });
          setClipboard({
            kind: "line",
            mode: "copy",
            sourceWeekNumber: selectedLine.weekNumber,
            sourceSessionKey: selectedLine.sessionKey,
            lineSource: selectedLine.source,
            blockIndex: selectedLine.blockIndex,
            itemIndex: selectedLine.itemIndex,
            block: extracted?.extracted,
          });
          return;
        }
        if (selection?.kind === "publication") {
          event.preventDefault();
          setClipboard({
            kind: "publication",
            mode: "copy",
            sourceWeekNumber: selection.weekNumber,
            sourceSessionKey: selection.sessionKey,
            publicationId: selection.itemId,
          });
        }
      }

      if (key === "v") {
        const weekNumber = selectedLine?.weekNumber ?? selection?.weekNumber;
        if (weekNumber == null) return;
        event.preventDefault();
        const sessionKey = selectedLine?.sessionKey ?? selection?.sessionKey;
        void handlePaste(
          weekNumber,
          sessionKey ? orderedSessions.find((entry) => entry.key === sessionKey) ?? null : null,
        );
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    classSetup.id,
    cutCarnetLine,
    deleteCarnetLine,
    editor,
    handlePaste,
    notesDocument,
    orderedSessions,
    selectedLine,
    selection,
    weekSourceDoc,
  ]);

  useEffect(() => {
    if (moveMenuCardId == null) return;
    function close(event: Event) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown") {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".class-notebook-move")) return;
      }
      setMoveMenuCardId(null);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [moveMenuCardId]);

  function openEditor(kind: EditorKind, weekNumber: number, session?: CourseSession | null) {
    const weekItems =
      session && courseSessions
        ? itemsForCourseSession(items, session, courseSessions)
        : items.filter((item) => item.schoolWeekNumber === weekNumber);
    const weekKey = weekNotesKey(classSetup.id, weekNumber);
    const doc =
      kind === "publication"
        ? composeWeekPublicationDoc(weekItems)
        : composeWeekNotesDoc(
            session
              ? listSessionNotes(notesDocument, sessionNotesKey(session.key))
              : listWeekNotes(notesDocument, weekKey),
          );
    setEditorDoc(doc);
    setStudentPreviewOpen(false);
    setEditor({ kind, weekNumber, sessionKey: session?.key ?? null });
  }

  async function saveEditor(studentVisible?: boolean) {
    if (!editor) return;
    const editorSession = editor.sessionKey
      ? orderedSessions.find((entry) => entry.key === editor.sessionKey) ?? null
      : null;
    if (editor.kind === "publication") {
      if (!canPublish) return;
      await onSaveWeekPublication(editor.weekNumber, editorDoc, {
        ...(studentVisible === undefined ? {} : { studentVisible }),
        session: editorSession,
      });
    } else if (editorSession) {
      onNotesChange(setSessionRichNote(notesDocument, sessionNotesKey(editorSession.key), editorDoc));
    } else {
      const key = weekNotesKey(classSetup.id, editor.weekNumber);
      onNotesChange(setWeekRichNote(notesDocument, key, editorDoc));
    }
    setEditor(null);
    setStudentPreviewOpen(false);
  }

  function handlePublicationDragStart(
    event: DragEvent<HTMLLIElement>,
    itemId: number,
    weekNumber: number,
    session?: CourseSession | null,
  ) {
    const payload: DragPayload = { kind: "week", itemId, weekNumber, sessionKey: session?.key };
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
    toSession?: CourseSession | null,
    fromSession?: CourseSession | null,
  ) {
    if (source === "publication" && !canPublish) return;
    const fromDoc = weekSourceDoc(source, fromWeek, fromSession);
    const sameCard = toSession && fromSession
      ? toSession.key === fromSession.key
      : !toSession && !fromSession && fromWeek === toWeek;

    if (sameCard) {
      if (atLineIndex == null) return;
      const fromIndex = visibleRichDocLines(fromDoc).findIndex(
        (line) => line.blockIndex === blockIndex && line.itemIndex === itemIndex,
      );
      const next = moveWeekUnitWithinDoc(fromDoc, blockIndex, itemIndex, atLineIndex);
      if (!next || next === fromDoc) return;
      await saveSourceDoc(source, toWeek, next, toSession ?? fromSession);
      if (fromIndex >= 0) {
        rememberLine(source, toWeek, next, lineIndexAfterMove(fromIndex, atLineIndex), toSession ?? fromSession);
      }
      return;
    }

    const moved = moveWeekUnitToDoc(
      fromDoc,
      weekSourceDoc(source, toWeek, toSession),
      blockIndex,
      itemIndex,
      atLineIndex,
    );
    if (!moved) return;
    if (source === "publication") {
      await onSaveWeekPublication(toWeek, moved.target, { session: toSession });
      await onSaveWeekPublication(fromWeek, moved.source, { session: fromSession });
    } else if (toSession || fromSession) {
      let next = notesDocument;
      if (fromSession) {
        next = setSessionRichNote(next, sessionNotesKey(fromSession.key), moved.source);
      } else {
        next = setWeekRichNote(next, weekNotesKey(classSetup.id, fromWeek), moved.source);
      }
      if (toSession) {
        next = setSessionRichNote(next, sessionNotesKey(toSession.key), moved.target);
      } else {
        next = setWeekRichNote(next, weekNotesKey(classSetup.id, toWeek), moved.target);
      }
      onNotesChange(next);
    } else {
      const fromKey = weekNotesKey(classSetup.id, fromWeek);
      const toKey = weekNotesKey(classSetup.id, toWeek);
      onNotesChange(setWeekRichNote(setWeekRichNote(notesDocument, fromKey, moved.source), toKey, moved.target));
    }
  }

  async function handleDropOnWeek(
    event: DragEvent<HTMLElement>,
    weekNumber: number,
    session?: CourseSession | null,
  ) {
    event.preventDefault();
    const payload = decodeCarnetMove(event.dataTransfer.getData("text/plain"), dragPayload);
    setDragPayload(null);
    setDropSlot(null);
    if (!payload) return;
    if (payload.kind === "week") {
      const source = items.find((item) => item.id === payload.itemId);
      if (!source) return;
      if (session) {
        if (source.courseSessionKey === session.key) return;
        await onMovePublication(payload.itemId, session.schoolWeekNumber, session);
        return;
      }
      if (payload.weekNumber === weekNumber || source.schoolWeekNumber === weekNumber) return;
      await onMovePublication(payload.itemId, weekNumber);
      return;
    }
    const atLineIndex = visibleRichDocLines(weekSourceDoc(payload.source, weekNumber, session)).length;
    const fromSession = payload.sessionKey
      ? orderedSessions.find((entry) => entry.key === payload.sessionKey) ?? null
      : null;
    await moveCarnetLine(
      payload.source,
      payload.weekNumber,
      weekNumber,
      payload.blockIndex,
      payload.itemIndex,
      atLineIndex,
      session,
      fromSession,
    );
  }

  function handleDropOnSlot(
    event: DragEvent<HTMLDivElement>,
    source: LineSource,
    weekNumber: number,
    atLineIndex: number,
    session?: CourseSession | null,
  ) {
    const payload = decodeCarnetMove(event.dataTransfer.getData("text/plain"), dragPayload);
    setDragPayload(null);
    setDropSlot(null);
    if (!payload || payload.kind !== "line" || payload.source !== source) return;
    const fromSession = payload.sessionKey
      ? orderedSessions.find((entry) => entry.key === payload.sessionKey) ?? null
      : null;
    void moveCarnetLine(
      payload.source,
      payload.weekNumber,
      weekNumber,
      payload.blockIndex,
      payload.itemIndex,
      atLineIndex,
      session,
      fromSession,
    );
  }

  function startLineDrag(
    event: DragEvent<HTMLDivElement>,
    source: LineSource,
    weekNumber: number,
    line: RichDocLine,
    session?: CourseSession | null,
  ) {
    const payload: DragPayload = {
      kind: "line",
      source,
      weekNumber,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
      sessionKey: session?.key,
    };
    setDragPayload(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", encodeCarnetMove(payload));
  }

  function selectAndCopyLine(
    source: LineSource,
    weekNumber: number,
    line: RichDocLine,
    session?: CourseSession | null,
  ) {
    setSelectedLine({
      source,
      weekNumber,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
      sessionKey: session?.key,
    });
    const extracted = extractWeekUnit(weekSourceDoc(source, weekNumber, session), line.blockIndex, line.itemIndex);
    if (extracted) rememberRichClip({ kind: "block", block: extracted.extracted });
    setClipboard({
      kind: "line",
      mode: "copy",
      sourceWeekNumber: weekNumber,
      sourceSessionKey: session?.key,
      lineSource: source,
      blockIndex: line.blockIndex,
      itemIndex: line.itemIndex,
      block: extracted?.extracted,
    });
  }

  function placeCopiedLine(
    weekNumber: number,
    source: LineSource,
    atLineIndex: number,
    session?: CourseSession | null,
  ) {
    if (!clipboard || clipboard.kind !== "line" || clipboard.lineSource !== source) return;
    const fromSession = clipboard.sourceSessionKey
      ? orderedSessions.find((entry) => entry.key === clipboard.sourceSessionKey) ?? null
      : null;
    if (clipboard.mode === "cut" && clipboard.block) {
      void saveSourceDoc(
        source,
        weekNumber,
        insertWeekUnitAt(weekSourceDoc(source, weekNumber, session), clipboard.block, atLineIndex),
        session,
      ).then(() => setClipboard({ ...clipboard, mode: "copy" }));
      return;
    }
    if (clipboard.blockIndex == null) return;
    const sameCard = session
      ? clipboard.sourceSessionKey === session.key
      : clipboard.sourceWeekNumber === weekNumber && !clipboard.sourceSessionKey;
    if (sameCard) {
      void moveCarnetLine(
        clipboard.lineSource,
        clipboard.sourceWeekNumber,
        weekNumber,
        clipboard.blockIndex,
        clipboard.itemIndex ?? null,
        atLineIndex,
        session,
        fromSession,
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
      fromSession,
      session,
    );
  }

  function nudgeSelectedLine(
    source: LineSource,
    weekNumber: number,
    line: RichDocLine,
    direction: -1 | 1,
    session?: CourseSession | null,
  ) {
    const doc = weekSourceDoc(source, weekNumber, session);
    const atLineIndex = adjacentWeekUnitInsertIndex(doc, line.blockIndex, line.itemIndex, direction);
    if (atLineIndex == null) return;
    void moveCarnetLine(
      source,
      weekNumber,
      weekNumber,
      line.blockIndex,
      line.itemIndex,
      atLineIndex,
      session,
      session,
    );
  }

  function lineSlotState(source: LineSource, weekNumber: number, canEdit: boolean, session?: CourseSession | null) {
    const dragging =
      dragPayload?.kind === "line" && dragPayload.source === source ? dragPayload : null;
    const copied =
      clipboard?.kind === "line" && clipboard.lineSource === source && clipboard.blockIndex != null
        ? clipboard
        : null;
    const showInsertSlots = canEdit && (dragging != null || copied != null);
    const fromThisWeek = dragging
      ? session
        ? dragging.sessionKey === session.key
        : dragging.weekNumber === weekNumber
      : session
        ? copied?.sourceSessionKey === session.key
        : copied?.sourceWeekNumber === weekNumber;
    const origin = dragging
      ? { blockIndex: dragging.blockIndex, itemIndex: dragging.itemIndex }
      : copied && copied.blockIndex != null
        ? { blockIndex: copied.blockIndex, itemIndex: copied.itemIndex ?? null }
        : null;
    const hiddenInsertSlots = new Set<number>();
    if (showInsertSlots && fromThisWeek && origin) {
      const doc = weekSourceDoc(source, weekNumber, session);
      const lines = visibleRichDocLines(doc);
      const fromIndex = lines.findIndex(
        (line) => line.blockIndex === origin.blockIndex && line.itemIndex === origin.itemIndex,
      );
      if (fromIndex >= 0) {
        const span = isListBlock(doc.blocks[origin.blockIndex])
          ? listBlockLineSpan(lines, origin.blockIndex)
          : { start: fromIndex, size: 1 };
        if (span) {
          for (let offset = 0; offset <= span.size; offset += 1) {
            hiddenInsertSlots.add(span.start + offset);
          }
        }
      }
    }
    return {
      showInsertSlots,
      insertSlotsDragging: dragging != null,
      hiddenInsertSlots,
      activeInsertSlot:
        dropSlot?.source === source &&
        (session
          ? dropSlot.sessionKey === session.key
          : dropSlot.weekNumber === weekNumber && !dropSlot.sessionKey)
          ? dropSlot.atLineIndex
          : null,
    };
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { kind, weekNumber, cardId } = deleteTarget;
    setDeleteTarget(null);
    const session = cardById(cardId)?.session ?? null;
    if (kind === "publication") {
      if (!canPublish) return;
      await onSaveWeekPublication(weekNumber, emptyRichDoc(), { session });
      return;
    }
    if (session) {
      onNotesChange(setSessionRichNote(notesDocument, sessionNotesKey(session.key), emptyRichDoc()));
      return;
    }
    onNotesChange(setWeekRichNote(notesDocument, weekNotesKey(classSetup.id, weekNumber), emptyRichDoc()));
  }

  const editorVisibility = editor
    ? weekCarnetVisibility(
        editor.sessionKey && courseSessions
          ? items.filter((item) => {
              const resolved = sessionForItem(item);
              return resolved?.key === editor.sessionKey;
            })
          : items.filter((item) => item.schoolWeekNumber === editor.weekNumber),
      )
    : "empty";
  const unpublishCard = unpublishCardId ? cardById(unpublishCardId) : undefined;

  function closeControlEditor() {
    setControlEditor(null);
    setControlTitle("");
    setControlDetail("");
    setControlError("");
    setControlSubmitting(false);
    setControlServerCoordination(null);
    setControlPreviewDay([]);
    setControlPreviewWeek([]);
    setControlPreviewConfirm(false);
  }

  function sessionForItem(item: PrototypeAgendaItem): CourseSession | null {
    if (!courseSessions) return null;
    if (item.courseSessionKey) {
      return courseSessions.find((session) => session.key === item.courseSessionKey) ?? null;
    }
    return courseSessionForControlSlot(courseSessions, item.schoolWeekNumber, item.day);
  }

  async function loadCreateCoordination(session: CourseSession) {
    try {
      const view = await fetchTeacherControlPlanningApi({
        classroomId: classroomId ?? undefined,
        week: session.schoolWeekNumber,
        view: "week",
        mode: "class-all",
      });
      const day = view.week?.days.find((entry) => entry.dayIndex === session.dayOfWeek - 1);
      const option =
        day?.placementOptions.find((entry) => entry.courseSessionKey === session.key) ??
        (classroomId
          ? {
              classroomId,
              classroomName: classSetup.name,
              annualCourseId: session.annualCourseId,
              courseSessionKey: session.key,
              date: session.date,
              schoolWeekNumber: session.schoolWeekNumber,
              dayIndex: session.dayOfWeek - 1,
              branchLabel,
            }
          : null);
      const classDay = option && day ? classDayControlsForPlacementOption(day.classDayControls, option) : [];
      setControlPreviewDay(classDay);
      setControlPreviewWeek(view.teacherWeekControls);
      setControlPreviewConfirm(
        option ? confirmationRequiredForPlacementOption(day?.classDayControls ?? [], option) : false,
      );
    } catch {
      setControlPreviewDay([]);
      setControlPreviewWeek([]);
      setControlPreviewConfirm(false);
    }
  }

  function openCreateForSession(session: CourseSession) {
    setControlsOpen(false);
    setControlEditor({ mode: "create", session });
    setControlTitle("");
    setControlDetail("");
    setControlError("");
    setControlServerCoordination(null);
    setControlPreviewDay([]);
    setControlPreviewWeek([]);
    setControlPreviewConfirm(false);
    void loadCreateCoordination(session);
  }

  function openEditControl(item: PrototypeAgendaItem) {
    setControlsOpen(false);
    setControlEditor({ mode: "edit", item, session: sessionForItem(item) });
    setControlTitle(item.title);
    setControlDetail(controlEditorDetailValue(item.detail));
    setControlError("");
    setControlServerCoordination(null);
  }

  function startPlanForSession(session: CourseSession) {
    openCreateForSession(session);
  }

  async function submitControlEditor(confirm: boolean) {
    if (!controlEditor || controlSubmitting) return;
    const trimmed = controlTitle.trim();
    if (!trimmed) {
      setControlError("Le titre du contrôle est obligatoire.");
      return;
    }
    setControlSubmitting(true);
    setControlError("");
    try {
      if (controlEditor.mode === "create") {
        const session = controlEditor.session;
        await onSaveControl({
          annualCourseId: session.annualCourseId,
          courseSessionKey: session.key,
          schoolWeekNumber: session.schoolWeekNumber,
          day: session.dayOfWeek - 1,
          title: trimmed,
          detail: controlDetail,
          confirmCoordination: confirm,
        });
        closeControlEditor();
        return;
      }
      await onUpdateControl(controlEditor.item.id, { title: trimmed, detail: controlDetail });
      closeControlEditor();
    } catch (caught) {
      if (caught instanceof ControlCoordinationRequiredError) {
        setControlServerCoordination(caught.coordination);
        setControlError(caught.message);
      } else {
        setControlError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
      }
    } finally {
      setControlSubmitting(false);
    }
  }

  const editorSession = controlEditor?.mode === "create" ? controlEditor.session : controlEditor?.session ?? null;
  const editorWeekday = editorSession
    ? formatControlSessionDayLabel(editorSession).split(" ")[0] ?? ""
    : weekdayLabelForCourseDayIndex(controlEditor?.mode === "edit" ? controlEditor.item.day : 0);
  const editorDateLabel = editorSession
    ? formatControlSessionDayLabel(editorSession)
    : formatControlEditorDateLabel(
        editorWeekday.charAt(0).toUpperCase() + editorWeekday.slice(1),
        controlEditor?.mode === "edit" ? controlEditor.item.courseSessionDate : null,
      );
  const editorCourseCaption = formatControlEditorCourseCaption(
    branchLabel,
    editorSession ? formatCourseSessionPeriods(editorSession.segments) : null,
  );
  const editorConfirmation = controlServerCoordination
    ? Boolean(controlServerCoordination.confirmationRequired)
    : controlPreviewConfirm;
  const editorClassDay = controlServerCoordination
    ? controlServerCoordination.classDayControls
    : controlPreviewDay;
  const editorTeacherWeek = controlServerCoordination
    ? controlServerCoordination.teacherWeekControls
    : controlPreviewWeek;

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
          <button
            type="button"
            className="workspace-action secondary"
            onClick={() => setControlsOpen(true)}
            disabled={structuredCourse && (sessionsLoading || (courseSessions != null && courseSessions.length === 0))}
          >
            Contrôles 📅
          </button>
          {onPreviewStudent ? (
            <button type="button" className="workspace-action secondary" onClick={onPreviewStudent}>
              Aperçu élève
            </button>
          ) : null}
          {annualCourseId?.trim() ? (
            <button type="button" className="workspace-action secondary" onClick={() => setExportOpen(true)}>
              📄 Exporter le carnet
            </button>
          ) : null}
        </div>
      </div>

      {!canPublish && publishBlockedReason ? (
        <p className="class-notebook-warning">{publishBlockedReason}</p>
      ) : null}

      <div className="class-notebook-week-controls">
        <div className="class-notebook-shift">
          <button type="button" onClick={() => shiftVisibleWeeks(-1)} aria-label="Séances précédentes">
            ◀
          </button>
          <button type="button" onClick={() => shiftVisibleWeeks(1)} aria-label="Séances suivantes">
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
              {count} séance{count > 1 ? "s" : ""}
            </label>
          ))}
        </fieldset>
      </div>

      {structuredCourse && sessionsLoading ? (
        <p className="class-notebook-empty">Chargement des séances du cours…</p>
      ) : null}
      {structuredCourse && !sessionsLoading && sessionsError ? (
        <p className="class-notebook-warning">{sessionsError}</p>
      ) : null}
      {structuredCourse && !sessionsLoading && !sessionsError && courseSessions?.length === 0 ? (
        <p className="class-notebook-empty">Aucune séance planifiée pour ce cours dans l’horaire.</p>
      ) : null}
      {structuredCourse && !sessionsLoading && structuredCourseId && courseSessions?.length === 0
        ? orphanedSessionNotesForCourse(notesDocument, structuredCourseId).map((entry) => (
            <div
              key={entry.sessionKey}
              className="class-notebook-pending-notes"
              data-orphaned-session-notes={entry.sessionKey}
            >
              <p>Note d’une séance disparue — à réattribuer</p>
              <RichDocView doc={composeWeekNotesDoc(entry.notes)} compact emptyLabel="" />
            </div>
          ))
        : null}
      {structuredCourse && courseSessions
        ? pendingWeekNotesWithoutSession(notesDocument, classSetup.id, courseSessions).map((entry) => (
            <div
              key={entry.weekKey}
              className="class-notebook-pending-notes"
              data-pending-week-notes=""
              data-pending-week-unscheduled={entry.weekNumber}
            >
              <p>
                Note ancienne de la semaine {String(entry.weekNumber).padStart(2, "0")} — séance à attribuer
              </p>
              <RichDocView doc={composeWeekNotesDoc(entry.notes)} compact emptyLabel="" />
            </div>
          ))
        : null}

      <div
        className={`class-notebook-grid class-notebook-grid-${effectiveWeekDisplayCount}`}
        style={{ gridTemplateColumns: `repeat(${Math.max(visibleCards.length, 1)}, minmax(0, 1fr))` }}
      >
        {visibleCards.map((card) => {
          const weekNumber = card.weekNumber;
          const week = card.week;
          const session = card.session;
          const weekKey = weekNotesKey(classSetup.id, weekNumber);
          const scopedItems =
            session && courseSessions
              ? itemsForCourseSession(items, session, courseSessions)
              : items.filter((item) => item.schoolWeekNumber === weekNumber);
          const weekNotes = session
            ? listSessionNotes(notesDocument, sessionNotesKey(session.key))
            : listWeekNotes(notesDocument, weekKey);
          const pendingNotes = listPendingWeekNotes(notesDocument, weekKey);
          const weekControls = scopedItems.filter((item) => item.type === "TEST");
          const weekCarnetPublications = scopedItems.filter(isCarnetOwnedPublication);
          const weekStructuredPublications = scopedItems.filter(
            (item) =>
              isPublicationLine(item) &&
              !isCarnetOwnedPublication(item) &&
              isStructuredPublication(item),
          );
          const isActive = card.id === (displayStartSession?.key ?? `week:${displayStartWeek}`);
          const visibility = weekCarnetVisibility(weekCarnetPublications);
          const publicationSlots = lineSlotState("publication", weekNumber, canPublish, session);
          const notesSlots = lineSlotState("notes", weekNumber, true, session);
          const lineDropActive = session
            ? (dragPayload?.kind === "line" && dragPayload.sessionKey !== session.key) ||
              (clipboard?.kind === "line" && clipboard.sourceSessionKey !== session.key)
            : (dragPayload?.kind === "line" && dragPayload.weekNumber !== weekNumber) ||
              (clipboard?.kind === "line" && clipboard.sourceWeekNumber !== weekNumber);
          const weekDropActive =
            dragPayload?.kind === "week" &&
            (session ? dragPayload.sessionKey !== session.key : dragPayload.weekNumber !== weekNumber);

          return (
            <article
              key={card.id}
              className={`class-notebook-column${isActive ? " active" : ""}${
                weekDropActive || lineDropActive ? " is-drop-target" : ""
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => void handleDropOnWeek(event, weekNumber, session)}
            >
              <header className="class-notebook-column-header">
                <button
                  type="button"
                  onClick={() => {
                    if (session) {
                      setCenterSessionKey(session.key);
                      onCenterWeekChange(session.schoolWeekNumber);
                      return;
                    }
                    onCenterWeekChange(weekNumber);
                  }}
                >
                  <strong>
                    {session
                      ? formatCourseSessionCardWeekLabel(session, week)
                      : week
                        ? formatWeekColumnLabel(week)
                        : `Sem ${String(weekNumber).padStart(2, "0")}`}
                  </strong>
                  <span>
                    {session
                      ? formatCourseSessionCardSubtitle(session)
                      : week
                        ? formatWeekColumnSubtitle(week)
                        : ""}
                  </span>
                </button>
              </header>

              <section className="class-notebook-zone class-notebook-zone-control" aria-label="Contrôle">
                <h3>Contrôle</h3>
                {weekControls.length ? (
                  <ul>
                    {weekControls.map((item) => (
                      <li
                        key={item.id}
                        className="class-notebook-control-line"
                        data-control-line=""
                        draggable
                        onDragStart={(event) => handlePublicationDragStart(event, item.id, weekNumber, session)}
                      >
                        <button
                          type="button"
                          className="class-notebook-control-open"
                          onClick={() => openEditControl(item)}
                        >
                          <span className="class-notebook-control-title">{item.title}</span>
                          <span className="class-notebook-control-day">
                            {weekdayLabelForCourseDayIndex(item.day) || (item.day === 3 ? "jeudi" : "lundi")}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="class-notebook-control-delete"
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
                ) : null}
                {session ? (
                  <button
                    type="button"
                    className="class-notebook-plan-link"
                    data-control-plan-week=""
                    data-course-session-key={session.key}
                    onClick={() => startPlanForSession(session)}
                  >
                    Planifier →
                  </button>
                ) : null}
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
                        aria-label={`Déplacer la publication de ${session ? formatCourseSessionCardWeekLabel(session, week) : week ? formatWeekColumnLabel(week) : "cette séance"}`}
                        aria-expanded={moveMenuCardId === card.id}
                        title="Glisser, ou cliquer pour choisir la séance"
                        onDragStart={(event) => {
                          const itemId = weekCarnetPublications[0]!.id;
                          const payload: DragPayload = {
                            kind: "week",
                            itemId,
                            weekNumber: weekNumber,
                            sessionKey: session?.key,
                          };
                          setDragPayload(payload);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", encodeCarnetMove(payload));
                        }}
                        onDragEnd={() => {
                          setDragPayload(null);
                          setDropSlot(null);
                        }}
                        onClick={() =>
                          setMoveMenuCardId((current) => (current === card.id ? null : card.id))
                        }
                      >
                        ⠿
                      </button>
                      {moveMenuCardId === card.id ? (
                        <menu className="class-notebook-move-menu">
                          <li className="class-notebook-move-menu-title">Déplacer vers</li>
                          {(session
                            ? moveTargetCourseSessions(orderedSessions, session.key).map((target) => ({
                                id: target.key,
                                label: `${formatCourseSessionCardWeekLabel(target, schoolWeekForSession(schoolWeeks, target))} · ${formatCourseSessionCardSubtitle(target)}`,
                                onPick: () =>
                                  void onMovePublication(
                                    weekCarnetPublications[0]!.id,
                                    target.schoolWeekNumber,
                                    target,
                                  ),
                              }))
                            : moveTargetSchoolWeeks(schoolWeeks, weekNumber).map((entry) => ({
                                id: String(entry.number),
                                label: formatWeekColumnLabel(entry),
                                onPick: () => void onMovePublication(weekCarnetPublications[0]!.id, entry.number),
                              }))
                          ).map((entry) => (
                              <li key={entry.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoveMenuCardId(null);
                                    entry.onPick();
                                  }}
                                >
                                  {entry.label}
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
                      selectedLine?.source === "publication" &&
                      selectedLine.weekNumber === weekNumber &&
                      (session ? selectedLine.sessionKey === session.key : !selectedLine.sessionKey)
                        ? lineViewKey(selectedLine)
                        : undefined
                    }
                    showInsertSlots={publicationSlots.showInsertSlots}
                    insertSlotsDragging={publicationSlots.insertSlotsDragging}
                    activeInsertSlot={publicationSlots.activeInsertSlot}
                    hiddenInsertSlots={publicationSlots.hiddenInsertSlots}
                    emptyLabel="Aucune publication pour cette séance."
                    onLineClick={
                      canPublish
                        ? (line) => selectAndCopyLine("publication", weekNumber, line, session)
                        : undefined
                    }
                    onLineDragStart={
                      canPublish
                        ? (line, event) => startLineDrag(event, "publication", weekNumber, line, session)
                        : undefined
                    }
                    onLineDragEnd={() => {
                      setDragPayload(null);
                      setDropSlot(null);
                    }}
                    onInsertSlot={
                      canPublish ? (at) => placeCopiedLine(weekNumber, "publication", at, session) : undefined
                    }
                    onInsertSlotDragOver={
                      canPublish
                        ? (at) =>
                            setDropSlot({
                              source: "publication",
                              weekNumber: weekNumber,
                              atLineIndex: at,
                              sessionKey: session?.key,
                              cardId: card.id,
                            })
                        : undefined
                    }
                    onInsertSlotDrop={
                      canPublish
                        ? (at, event) => handleDropOnSlot(event, "publication", weekNumber, at, session)
                        : undefined
                    }
                    onMoveLine={
                      canPublish
                        ? (line, direction) => nudgeSelectedLine("publication", weekNumber, line, direction, session)
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
                    onClick={() => openEditor("publication", weekNumber, session)}
                  >
                    {visibility === "empty" ? "Rédiger" : "Modifier"}
                  </button>
                  {visibility === "draft" && canPublish ? (
                    <button
                      type="button"
                      className="workspace-action"
                      onClick={() => void onSetWeekPublicationVisibility(weekNumber, true, session?.key)}
                    >
                      Publier aux élèves
                    </button>
                  ) : null}
                  {visibility === "published" && canPublish ? (
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() => setUnpublishCardId(card.id)}
                    >
                      Repasser en brouillon
                    </button>
                  ) : null}
                  {visibility !== "empty" && canPublish ? (
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() => setDeleteTarget({ kind: "publication", weekNumber: weekNumber, cardId: card.id })}
                    >
                      Supprimer
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="class-notebook-zone class-notebook-zone-notes" aria-label="Notes prof">
                <h3>Notes prof</h3>
                {pendingNotes.length && session ? (
                  <div className="class-notebook-pending-notes" data-pending-week-notes="">
                    <p>Note ancienne de la semaine — séance à attribuer</p>
                    <RichDocView doc={composeWeekNotesDoc(pendingNotes)} compact emptyLabel="" />
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() =>
                        onNotesChange(assignPendingWeekNotes(notesDocument, weekKey, session.key))
                      }
                    >
                      Attribuer à cette séance
                    </button>
                  </div>
                ) : null}
                {session
                  ? orphanedSessionNotesForCourse(notesDocument, session.annualCourseId).map((entry) => (
                      <div
                        key={entry.sessionKey}
                        className="class-notebook-pending-notes"
                        data-orphaned-session-notes={entry.sessionKey}
                      >
                        <p>Note d’une séance disparue — à réattribuer</p>
                        <RichDocView doc={composeWeekNotesDoc(entry.notes)} compact emptyLabel="" />
                        <button
                          type="button"
                          className="workspace-action secondary"
                          onClick={() =>
                            onNotesChange(assignOrphanedSessionNotes(notesDocument, entry.sessionKey, session.key))
                          }
                        >
                          Attribuer à cette séance
                        </button>
                      </div>
                    ))
                  : null}
                <div className="class-notebook-lines">
                  <RichDocView
                    doc={composeWeekNotesDoc(weekNotes)}
                    compact
                    interactive
                    lineDraggable
                    selectedLineKey={
                      selectedLine?.source === "notes" &&
                      selectedLine.weekNumber === weekNumber &&
                      (session ? selectedLine.sessionKey === session.key : !selectedLine.sessionKey)
                        ? lineViewKey(selectedLine)
                        : undefined
                    }
                    showInsertSlots={notesSlots.showInsertSlots}
                    insertSlotsDragging={notesSlots.insertSlotsDragging}
                    activeInsertSlot={notesSlots.activeInsertSlot}
                    hiddenInsertSlots={notesSlots.hiddenInsertSlots}
                    emptyLabel="Aucune note privée."
                    onLineClick={(line) => selectAndCopyLine("notes", weekNumber, line, session)}
                    onLineDragStart={(line, event) => startLineDrag(event, "notes", weekNumber, line, session)}
                    onLineDragEnd={() => {
                      setDragPayload(null);
                      setDropSlot(null);
                    }}
                    onInsertSlot={(at) => placeCopiedLine(weekNumber, "notes", at, session)}
                    onInsertSlotDragOver={(at) =>
                      setDropSlot({
                        source: "notes",
                        weekNumber: weekNumber,
                        atLineIndex: at,
                        sessionKey: session?.key,
                        cardId: card.id,
                      })
                    }
                    onInsertSlotDrop={(at, event) => handleDropOnSlot(event, "notes", weekNumber, at, session)}
                    onMoveLine={(line, direction) => nudgeSelectedLine("notes", weekNumber, line, direction, session)}
                  />
                </div>
                <div className="class-notebook-zone-actions">
                  <button
                    type="button"
                    className="workspace-action secondary"
                    onClick={() => openEditor("notes", weekNumber, session)}
                  >
                    Modifier
                  </button>
                  {!isEmptyRichDoc(composeWeekNotesDoc(weekNotes)) ? (
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() => setDeleteTarget({ kind: "notes", weekNumber: weekNumber, cardId: card.id })}
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
            ? "Bloc sélectionné — Suppr l’efface, Ctrl+X la coupe, survolez entre les blocs pour coller, ou ↑ ↓."
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
                  ? "Rédiger la publication de la séance"
                  : "Notes privées de la séance"}
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
        open={unpublishCardId != null}
        title="Repasser en brouillon"
        body={
          unpublishCard?.session
            ? `${formatCourseSessionCardWeekLabel(unpublishCard.session, unpublishCard.week)} disparaît de l’agenda élève. Le texte reste dans le Carnet.`
            : "Cette séance disparaît de l’agenda élève. Le texte reste dans le Carnet."
        }
        confirmLabel="Masquer aux élèves"
        cancelLabel="Annuler"
        onCancel={() => setUnpublishCardId(null)}
        onConfirm={() => {
          if (!unpublishCard) return;
          const weekNumber = unpublishCard.weekNumber;
          const sessionKey = unpublishCard.session?.key;
          setUnpublishCardId(null);
          void onSetWeekPublicationVisibility(weekNumber, false, sessionKey);
        }}
      />
      <ConfirmDialog
        open={deleteTarget != null}
        title={deleteTarget?.kind === "notes" ? "Supprimer les notes" : "Supprimer la publication"}
        body={
          deleteTarget?.kind === "notes"
            ? "Toutes les notes privées de cette séance seront effacées. Cette action ne peut pas être annulée."
            : "Tout le texte de cette séance sera effacé. Cette action ne peut pas être annulée."
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
        schoolWeeks={structuredCourse ? eligibleWeeks : schoolWeeks}
        courseSessions={structuredCourse ? courseSessions : null}
        controls={classControls}
        onClose={() => setControlsOpen(false)}
        onSelect={openEditControl}
        onDelete={onDeleteControl}
      />
      {controlEditor ? (
        <ControlEditorModal
          mode={controlEditor.mode}
          classroomName={classSetup.name}
          dateLabel={editorDateLabel}
          weekdayLabel={editorWeekday}
          courseCaption={editorCourseCaption}
          classDayControls={editorClassDay}
          teacherWeekControls={editorTeacherWeek}
          submitting={controlSubmitting}
          error={controlError}
          confirmationRequired={editorConfirmation}
          title={controlTitle}
          detail={controlDetail}
          onTitle={setControlTitle}
          onDetail={setControlDetail}
          onClose={closeControlEditor}
          onSubmit={(confirm) => void submitControlEditor(confirm)}
        />
      ) : null}
      {annualCourseId?.trim() ? (
        <NotebookExportModal
          open={exportOpen}
          annualCourseId={annualCourseId}
          classLabel={classSetup.name}
          branchLabel={branchLabel}
          schoolYearLabel={schoolYearLabel?.trim() || ""}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
    </section>
  );
}
