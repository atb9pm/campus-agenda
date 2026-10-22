import { APP_VERSION } from "../../lib/app-version.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { AnnualCourseNotesStore, PedagogicalPathStore } from "../../lib/persistence/pedagogical-path-types.ts";
import {
  isPrivateNoteApplySkipReason,
  planPrivateNoteCopies,
  privateNoteCopyId,
  previewPrivateNotes,
  type PrivateNotePreviewEntry,
} from "./private-notes.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import { parseCourseSessionKey } from "../course-sessions/compute.ts";
import {
  isPendingTargetCourseId,
  PENDING_TARGET_COURSE_PREFIX,
} from "./continuation-identity.ts";
import { assembleLiveYearTransitionPreviewInput } from "./assemble.ts";
import {
  YEAR_TRANSITION_APPLY_BLOCKING_REASONS,
  YEAR_TRANSITION_APPLY_RESULTS,
  type PersistedYearTransitionApply,
  type PersistedYearTransitionApplyEntry,
  type YearTransitionApplyAgendaInsert,
  type YearTransitionApplyFailure,
  type YearTransitionApplyOutcome,
  type YearTransitionApplyPlan,
  type YearTransitionApplyResult,
  type YearTransitionApplyStore,
} from "./apply-types.ts";
import {
  isNoteReclassifyReason,
  isPublicationReclassifyReason,
} from "./disposition.ts";
import {
  YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
  yearTransitionPreviewFingerprintFromSnapshotJson,
  yearTransitionPreviewMaterialSnapshotJson,
  yearTransitionSourceMaterialFingerprint,
} from "./fingerprint.ts";
import {
  materializeSelectedContinuations,
  persistTargetMeetingDayPlans,
} from "./materialize-continuations.ts";
import { usesExplicitTargetMeetingDayPlans } from "./target-meeting-days.ts";
import { YEAR_TRANSITION_AGENDA_COMPAT_HOUR, buildYearTransitionPreview } from "./preview.ts";
import { extractClassMappingsFromSnapshotJson, YearTransitionSnapshotCorruptedError } from "./snapshot-mappings.ts";
import type { PersistedYearTransitionPreview, YearTransitionPreviewStore } from "./store.ts";
import type { YearTransitionPreviewReason } from "./reasons.ts";
import type { YearTransitionPreviewEntry, YearTransitionPreviewInput } from "./types.ts";

export interface ApplyPersistedYearTransitionDeps {
  notes?: AnnualCourseNotesStore;
  previews: YearTransitionPreviewStore;
  applyStore: YearTransitionApplyStore;
  years: SchoolYearStore;
  catalog?: SchoolCatalogStore;
  courses: AnnualCourseStore;
  agenda: AgendaStore;
  paths: PedagogicalPathStore;
  schedules: CourseScheduleStore;
  adapters: RuntimeAgendaAdapterStore;
  now?: () => string;
}

const BLOCKING = new Set<string>(YEAR_TRANSITION_APPLY_BLOCKING_REASONS);
const APPLY_RESULTS = new Set<string>(YEAR_TRANSITION_APPLY_RESULTS);

/**
 * Legacy uniquement (`targetMeetingDayPlans` absent) : APPLY copiait les notes
 * du propriétaire de session. Le nouveau flux copie toutes les notes du cours.
 */
function legacyOwnedNotesForApply(input: YearTransitionPreviewInput): YearTransitionPreviewInput {
  const owner = input.privateNotesOwnerTeacherId?.trim();
  if (!input.includePrivateNotes || !owner) return input;
  const owned = (notes: YearTransitionPreviewInput["sourceNotes"]) =>
    (notes ?? []).filter((note) => note.ownerTeacherId === owner);
  return {
    ...input,
    sourceNotes: owned(input.sourceNotes),
    targetNotes: owned(input.targetNotes),
  };
}

function notesInputForApply(input: YearTransitionPreviewInput): YearTransitionPreviewInput {
  return usesExplicitTargetMeetingDayPlans(input.targetMeetingDayPlans)
    ? input
    : legacyOwnedNotesForApply(input);
}

function isKnownApplyResult(value: string): value is YearTransitionApplyResult {
  return APPLY_RESULTS.has(value);
}

function itemsWithApplyProvenance(
  items: readonly PrototypeAgendaItem[],
  transitionId: string,
  sourceAgendaItemId: number,
): PrototypeAgendaItem[] {
  return items.filter(
    (item) =>
      (item.sourceTransitionId ?? null) === transitionId &&
      Number(item.sourceAgendaItemId) === sourceAgendaItemId,
  );
}

function fail(code: YearTransitionApplyFailure["code"], extra: Partial<YearTransitionApplyFailure> = {}): YearTransitionApplyFailure {
  return { ok: false, code, reason: code, ...extra };
}

function isConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|PRIMARY KEY constraint failed|SQLITE_CONSTRAINT/i.test(message);
}

function skipResult(reason: YearTransitionPreviewReason | string): YearTransitionApplyResult | null {
  if (reason === "CLASS_CONTINUATION_ABSENT") return "SKIPPED_NO_CONTINUATION";
  if (reason === "ORPHAN_NO_REFERENCE_ITEM" || reason === "SOURCE_SESSION_UNRESOLVED") {
    return "SKIPPED_NO_REFERENCE";
  }
  if (
    reason === "ORPHAN_DEAD_REFERENCE_ITEM" ||
    reason === "PATH_ABSENT" ||
    reason === "PATH_POSITION_UNRESOLVED"
  ) {
    return "SKIPPED_DEAD_REFERENCE";
  }
  if (reason === "UNSCHEDULED_REFERENCE_SESSION") return "SKIPPED_UNSCHEDULED";
  return null;
}

export function expectedApplyResultForPreviewReason(
  reason: YearTransitionPreviewReason | string,
  options?: { zeroLoss?: boolean; targetAnnualCourseId?: string | null },
): YearTransitionApplyResult | null {
  if (reason === "PROJECTABLE") return "CREATED";
  if (reason === "ALREADY_PRESENT") return "ALREADY_PRESENT";
  if (
    options?.zeroLoss &&
    options.targetAnnualCourseId?.trim() &&
    isPublicationReclassifyReason(reason)
  ) {
    return "CREATED_UNPLACED";
  }
  return skipResult(reason);
}

function sameNullableId(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = left?.trim() ? left.trim() : null;
  const normalizedRight = right?.trim() ? right.trim() : null;
  return normalizedLeft === normalizedRight;
}

function liveTargetMatchesPreviewTarget(
  previewTargetId: string | null | undefined,
  liveTargetId: string | null | undefined,
  snapshot: YearTransitionPreviewInput,
  liveCourses: readonly AnnualCourse[],
  targetSchoolYearId: string,
): boolean {
  if (sameNullableId(previewTargetId, liveTargetId)) return true;
  const previewId = previewTargetId?.trim() || "";
  const liveId = liveTargetId?.trim() || "";
  if (!isPendingTargetCourseId(previewId) || !liveId) return false;
  const sourceId = previewId.slice(PENDING_TARGET_COURSE_PREFIX.length);
  const source = snapshot.sourceCourses.find((course) => course.id === sourceId);
  const live = liveCourses.find((course) => course.id === liveId);
  return Boolean(
    source &&
      live &&
      live.schoolYearId === targetSchoolYearId &&
      live.contextId === source.contextId &&
      !live.isArchived,
  );
}

function mapBySourceAgendaItemId<T extends { sourceAgendaItemId: number }>(
  entries: readonly T[],
): Map<number, T> | null {
  const map = new Map<number, T>();
  for (const entry of entries) {
    if (map.has(entry.sourceAgendaItemId)) return null;
    map.set(entry.sourceAgendaItemId, entry);
  }
  return map;
}

function countByResult(entries: readonly PersistedYearTransitionApplyEntry[]) {
  let createdCount = 0;
  let toReclassifyCount = 0;
  let alreadyPresentCount = 0;
  let skippedCount = 0;
  for (const entry of entries) {
    if (entry.applyResult === "CREATED") createdCount += 1;
    else if (entry.applyResult === "CREATED_UNPLACED") toReclassifyCount += 1;
    else if (entry.applyResult === "ALREADY_PRESENT") alreadyPresentCount += 1;
    else skippedCount += 1;
  }
  return { createdCount, toReclassifyCount, alreadyPresentCount, skippedCount };
}

function success(
  code: "APPLIED" | "ALREADY_APPLIED",
  apply: PersistedYearTransitionApply,
  entries: PersistedYearTransitionApplyEntry[],
  privateNotes?: PrivateNotePreviewEntry[],
): YearTransitionApplyOutcome {
  return {
    ...(privateNotes ? { privateNotes: {
      createdCount: privateNotes.filter(e => e.disposition === "PROJECTABLE" || e.reason === "PROJECTABLE").length,
      toReclassifyCount: privateNotes.filter(e => e.disposition === "TO_RECLASSIFY").length,
      alreadyPresentCount: privateNotes.filter(e => e.reason === "ALREADY_PRESENT").length,
      skippedCount: privateNotes.filter(
        e => e.disposition !== "PROJECTABLE" && e.disposition !== "TO_RECLASSIFY" && e.reason !== "PROJECTABLE" && e.reason !== "ALREADY_PRESENT",
      ).length,
      entries: privateNotes,
    } } : {}),
    ok: true,
    code,
    transitionId: apply.transitionId,
    fingerprint: apply.fingerprint,
    ...countByResult(entries),
    entries,
  };
}

async function verifyExistingApply(
  deps: ApplyPersistedYearTransitionDeps,
  apply: PersistedYearTransitionApply,
  persisted: PersistedYearTransitionPreview,
): Promise<YearTransitionApplyOutcome> {
  const snapshot = JSON.parse(persisted.snapshotJson) as YearTransitionPreviewInput;
  const liveTargetCoursesForVerify = (await deps.courses.listCourses()).filter(
    (course) => course.schoolYearId === persisted.targetSchoolYearId && !course.isArchived,
  );
  if (snapshot.includePrivateNotes) {
    if (!deps.notes) return fail("APPLY_LEDGER_DIVERGED");
    const newFlow = usesExplicitTargetMeetingDayPlans(snapshot.targetMeetingDayPlans);
    if (!newFlow && !snapshot.privateNotesOwnerTeacherId) return fail("APPLY_LEDGER_DIVERGED");
    const notePreview = previewPrivateNotes(notesInputForApply(snapshot));
    const liveTargetCourses = liveTargetCoursesForVerify;
    const listed = newFlow
      ? (
          await Promise.all(liveTargetCourses.map((course) => deps.notes!.listNotesByAnnualCourse(course.id)))
        ).flat()
      : await deps.notes.listNotesByOwner(snapshot.privateNotesOwnerTeacherId!);
    for (const entry of notePreview) {
      const copiedNow =
        entry.disposition === "PROJECTABLE" ||
        entry.disposition === "TO_RECLASSIFY" ||
        entry.reason === "PROJECTABLE" ||
        (newFlow && isNoteReclassifyReason(entry.reason));
      if (!copiedNow && entry.reason !== "ALREADY_PRESENT") continue;
      const candidates = listed.filter(n =>
        n.schoolYearId === persisted.targetSchoolYearId && n.sourceNoteId === entry.sourceNoteId);
      if (candidates.length !== 1) return fail("APPLY_LEDGER_DIVERGED");
      const note = candidates[0]!;
      const source = snapshot.sourceNotes?.find(n => n.id === entry.sourceNoteId);
      const pendingTarget = Boolean(
        entry.targetAnnualCourseId && isPendingTargetCourseId(entry.targetAnnualCourseId),
      );
      const liveTarget = liveTargetCourses.find((course) => course.id === note.annualCourseId);
      const unplaced = !entry.courseSessionKey?.trim() || entry.disposition === "TO_RECLASSIFY";
      const sessionDate = parseCourseSessionKey(entry.courseSessionKey ?? "")?.date;
      const copiedDate = parseCourseSessionKey(note.courseSessionKey ?? "")?.date;
      const idsMatch = pendingTarget
        ? Boolean(
            liveTarget &&
              liveTarget.contextId === source?.contextId &&
              note.classId === liveTarget.classId &&
              (unplaced ? !note.courseSessionKey?.trim() : Boolean(sessionDate && sessionDate === copiedDate)),
          )
        : note.annualCourseId === entry.targetAnnualCourseId &&
          (unplaced ? !note.courseSessionKey?.trim() : note.courseSessionKey === entry.courseSessionKey) &&
          note.classId === entry.targetClassId;
      if (!idsMatch
        || note.referenceSessionId !== entry.referenceSessionId
        || note.contextId !== source?.contextId
        || note.sourceSchoolYearId !== persisted.sourceSchoolYearId
        || (copiedNow && note.id !== privateNoteCopyId(persisted.id, entry.sourceNoteId))) {
        return fail("APPLY_LEDGER_DIVERGED");
      }
    }
  }
  if (apply.transitionId !== persisted.id) return fail("APPLY_LEDGER_DIVERGED");
  if (apply.fingerprint !== persisted.fingerprint) return fail("APPLY_LEDGER_DIVERGED");
  if (apply.engineVersion !== persisted.engineVersion) return fail("APPLY_LEDGER_DIVERGED");

  const previewEntries = await deps.previews.listEntries(persisted.id);
  const applyEntries = await deps.applyStore.listEntries(apply.transitionId);
  const previewBySource = mapBySourceAgendaItemId(previewEntries);
  const applyBySource = mapBySourceAgendaItemId(applyEntries);
  if (!previewBySource || !applyBySource) return fail("APPLY_LEDGER_DIVERGED");
  if (previewBySource.size !== applyBySource.size) return fail("APPLY_LEDGER_DIVERGED");
  for (const sourceAgendaItemId of previewBySource.keys()) {
    if (!applyBySource.has(sourceAgendaItemId)) return fail("APPLY_LEDGER_DIVERGED");
  }
  for (const sourceAgendaItemId of applyBySource.keys()) {
    if (!previewBySource.has(sourceAgendaItemId)) return fail("APPLY_LEDGER_DIVERGED");
  }

  const items = await deps.agenda.exportAllItems();
  for (const previewEntry of previewEntries) {
    const entry = applyBySource.get(previewEntry.sourceAgendaItemId);
    if (!entry) return fail("APPLY_LEDGER_DIVERGED");
    if (entry.transitionId !== apply.transitionId) return fail("APPLY_LEDGER_DIVERGED");
    if (entry.previewReason !== previewEntry.reason) return fail("APPLY_LEDGER_DIVERGED");
    if (
      !liveTargetMatchesPreviewTarget(
        previewEntry.targetAnnualCourseId,
        entry.targetAnnualCourseId,
        snapshot,
        liveTargetCoursesForVerify,
        persisted.targetSchoolYearId,
      )
    ) {
      return fail("APPLY_LEDGER_DIVERGED");
    }
    if (!sameNullableId(entry.referenceItemId, previewEntry.referenceItemId)) {
      return fail("APPLY_LEDGER_DIVERGED");
    }
    const expectedResult = expectedApplyResultForPreviewReason(previewEntry.reason, {
      zeroLoss: usesExplicitTargetMeetingDayPlans(snapshot.targetMeetingDayPlans),
      targetAnnualCourseId: previewEntry.targetAnnualCourseId,
    });
    if (!expectedResult || !isKnownApplyResult(entry.applyResult) || entry.applyResult !== expectedResult) {
      return fail("APPLY_LEDGER_DIVERGED");
    }

    if (entry.applyResult === "CREATED" || entry.applyResult === "CREATED_UNPLACED") {
      const found = itemsWithApplyProvenance(items, apply.transitionId, entry.sourceAgendaItemId);
      if (found.length !== 1) return fail("APPLY_LEDGER_DIVERGED");
      const created = found[0]!;
      if (
        !liveTargetMatchesPreviewTarget(
          previewEntry.targetAnnualCourseId,
          created.annualCourseId,
          snapshot,
          liveTargetCoursesForVerify,
          persisted.targetSchoolYearId,
        )
      ) {
        return fail("APPLY_LEDGER_DIVERGED");
      }
      if ((created.referenceItemId ?? null) !== (entry.referenceItemId ?? null)) {
        return fail("APPLY_LEDGER_DIVERGED");
      }
      if (entry.applyResult === "CREATED_UNPLACED") {
        if (created.courseSessionKey?.trim() || created.courseSessionDate?.trim()) {
          return fail("APPLY_LEDGER_DIVERGED");
        }
        if (created.studentVisible !== false) return fail("APPLY_LEDGER_DIVERGED");
      }
      continue;
    }
    if (entry.applyResult === "ALREADY_PRESENT") {
      const provenance = itemsWithApplyProvenance(items, apply.transitionId, entry.sourceAgendaItemId);
      if (provenance.length !== 0) return fail("APPLY_LEDGER_DIVERGED");
      const courseId = entry.targetAnnualCourseId?.trim() ?? "";
      if (!courseId) return fail("APPLY_LEDGER_DIVERGED");
      const fromSource = items.filter(
        (item) =>
          (item.annualCourseId ?? null) === courseId &&
          item.sourceAgendaItemId === entry.sourceAgendaItemId,
      );
      if (fromSource.length === 1) continue;
      const referenceId = entry.referenceItemId?.trim() ?? "";
      if (!referenceId) return fail("APPLY_LEDGER_DIVERGED");
      const found = items.filter(
        (item) => (item.annualCourseId ?? null) === courseId && (item.referenceItemId ?? null) === referenceId,
      );
      if (found.length !== 1) return fail("APPLY_LEDGER_DIVERGED");
      continue;
    }
    const unexpected = itemsWithApplyProvenance(items, apply.transitionId, entry.sourceAgendaItemId);
    if (unexpected.length !== 0) return fail("APPLY_LEDGER_DIVERGED");
  }
  return success("ALREADY_APPLIED", apply, applyEntries, snapshot.includePrivateNotes ? previewPrivateNotes(notesInputForApply(snapshot)) : undefined);
}

async function resolveClassroom(
  adapters: RuntimeAgendaAdapterStore,
  schoolClassId: string,
): Promise<{ ok: true; classroomId: string } | YearTransitionApplyFailure> {
  const classrooms = (await adapters.listClassrooms()).filter(
    (classroom) => (classroom.schoolClassId ?? "").trim() === schoolClassId,
  );
  if (classrooms.length === 0) return fail("TARGET_CLASSROOM_MISSING");
  if (classrooms.length > 1) return fail("TARGET_CLASSROOM_AMBIGUOUS");
  return { ok: true, classroomId: classrooms[0]!.id };
}

async function resolveSubject(
  adapters: RuntimeAgendaAdapterStore,
  annualCourseId: string,
  classroomId: string,
): Promise<{ ok: true; subjectId: string } | YearTransitionApplyFailure> {
  const subjects = (await adapters.listSubjects()).filter(
    (subject) => (subject.annualCourseId ?? "").trim() === annualCourseId,
  );
  if (subjects.length === 0) return fail("TARGET_SUBJECT_MISSING");
  if (subjects.length > 1) return fail("TARGET_SUBJECT_AMBIGUOUS");
  const subject = subjects[0]!;
  if (subject.classroomId !== classroomId) return fail("TARGET_SUBJECT_CLASSROOM_MISMATCH");
  return { ok: true, subjectId: subject.id };
}

function sourceById(items: readonly PrototypeAgendaItem[]): Map<number, PrototypeAgendaItem> {
  return new Map(items.map((item) => [item.id, item]));
}

function buildInsert(
  transitionId: string,
  targetYearId: string,
  entry: YearTransitionPreviewEntry,
  source: PrototypeAgendaItem,
  classroomId: string,
  subjectId: string,
  unplaced: boolean,
): YearTransitionApplyAgendaInsert | YearTransitionApplyFailure {
  const placement = entry.proposedPlacement;
  const carnetOwned = !source.referenceItemId?.trim() && !source.referenceSessionId?.trim();
  const referenceItemId = carnetOwned ? "" : (entry.referenceItemId?.trim() || source.referenceItemId?.trim() || "");
  const referenceSessionId = carnetOwned
    ? ""
    : (entry.resolvedReferenceSessionId?.trim() || source.referenceSessionId?.trim() || "");
  const annualCourseId = (unplaced ? entry.targetAnnualCourseId : placement?.annualCourseId)?.trim()
    || entry.targetAnnualCourseId?.trim()
    || "";
  if (!annualCourseId) {
    return fail("APPLY_BLOCKED");
  }
  if (unplaced) {
    if (placement) return fail("APPLY_BLOCKED");
    const author = source.authorTeacherId?.trim() ? source.authorTeacherId.trim() : null;
    return {
      classroomId,
      subjectId,
      authorTeacherId: author,
      day: 0,
      hour: YEAR_TRANSITION_AGENDA_COMPAT_HOUR,
      weekOffset: 0,
      schoolWeekNumber: 0,
      type: source.type,
      title: source.title,
      detail: source.detail,
      templateId: null,
      schoolYearId: targetYearId,
      annualCourseId,
      courseSessionKey: null,
      courseSessionDate: null,
      referenceSessionId: referenceSessionId || null,
      referenceItemId: referenceItemId || null,
      studentVisible: false,
      sourceTransitionId: transitionId,
      sourceAgendaItemId: source.id,
    };
  }
  if (!placement) {
    return fail("APPLY_BLOCKED");
  }
  if (!carnetOwned && (!referenceItemId || !referenceSessionId)) {
    return fail("APPLY_BLOCKED");
  }
  if (placement.schoolYearId !== targetYearId) {
    return fail("APPLY_BLOCKED");
  }
  const author = source.authorTeacherId?.trim() ? source.authorTeacherId.trim() : null;
  return {
    classroomId,
    subjectId,
    authorTeacherId: author,
    day: placement.day,
    hour: YEAR_TRANSITION_AGENDA_COMPAT_HOUR,
    weekOffset: 0,
    schoolWeekNumber: placement.schoolWeekNumber,
    type: source.type,
    title: source.title,
    detail: source.detail,
    templateId: null,
    schoolYearId: placement.schoolYearId,
    annualCourseId: placement.annualCourseId,
    courseSessionKey: placement.courseSessionKey,
    courseSessionDate: placement.courseSessionDate,
    referenceSessionId: referenceSessionId || null,
    referenceItemId: referenceItemId || null,
    studentVisible: false,
    sourceTransitionId: transitionId,
    sourceAgendaItemId: source.id,
  };
}

function ledgerEntry(
  transitionId: string,
  createdAt: string,
  preview: YearTransitionPreviewEntry,
  applyResult: YearTransitionApplyResult,
): PersistedYearTransitionApplyEntry {
  return {
    transitionId,
    sourceAgendaItemId: preview.sourceAgendaItemId,
    previewReason: preview.reason,
    applyResult,
    targetAnnualCourseId: preview.targetAnnualCourseId,
    referenceItemId: preview.referenceItemId,
    createdAt,
  };
}

/**
 * APPLY d’un PREVIEW persisté. Aucune mutation de N.
 * Le caller ne fournit que transitionId — destination et contenu viennent du PREVIEW + stores live.
 */
export async function applyPersistedYearTransition(
  transitionId: string,
  deps: ApplyPersistedYearTransitionDeps,
): Promise<YearTransitionApplyOutcome> {
  const persisted = await deps.previews.getById(transitionId);
  if (!persisted) return fail("TRANSITION_NOT_FOUND");

  const snapshotFingerprint = yearTransitionPreviewFingerprintFromSnapshotJson(persisted.snapshotJson);
  if (snapshotFingerprint !== persisted.fingerprint) return fail("PREVIEW_CORRUPTED");
  if (persisted.engineVersion !== YEAR_TRANSITION_PREVIEW_ENGINE_VERSION) {
    return fail("ENGINE_VERSION_MISMATCH");
  }

  const existingApply = await deps.applyStore.getByTransitionId(transitionId);
  if (existingApply) {
    return verifyExistingApply(deps, existingApply, persisted);
  }

  if (persisted.sourceSchoolYearId === persisted.targetSchoolYearId) {
    return fail("TARGET_YEAR_NOT_DRAFT");
  }
  const sourceYear = await deps.years.getSchoolYearById(persisted.sourceSchoolYearId);
  if (!sourceYear) {
    return fail("SOURCE_YEAR_NOT_FOUND");
  }
  const targetYear = await deps.years.getSchoolYearById(persisted.targetSchoolYearId);
  if (!targetYear || targetYear.status !== "draft") {
    return fail("TARGET_YEAR_NOT_DRAFT");
  }

  let classMappings;
  try {
    classMappings = extractClassMappingsFromSnapshotJson(persisted.snapshotJson);
  } catch (error) {
    if (error instanceof YearTransitionSnapshotCorruptedError) return fail("PREVIEW_CORRUPTED");
    throw error;
  }

  const snapshotOptions = JSON.parse(persisted.snapshotJson) as YearTransitionPreviewInput;
  const selectedSourceClassIds = [...(snapshotOptions.selectedSourceClassIds ?? [])];
  let liveMappings = classMappings;
  if (selectedSourceClassIds.length > 0) {
    if (!deps.catalog) {
      return fail("APPLY_BLOCKED", { reason: "Catalogue scolaire requis pour reprendre les classes." });
    }
    const materialized = await materializeSelectedContinuations(
      { ...deps, catalog: deps.catalog },
      {
        selectedSourceClassIds,
        sourceSchoolYearId: persisted.sourceSchoolYearId,
        targetSchoolYearId: persisted.targetSchoolYearId,
        targetMeetingDayPlans: snapshotOptions.targetMeetingDayPlans,
        selectedSourceAnnualCourseIds: snapshotOptions.selectedSourceAnnualCourseIds,
      },
    );
    if (!materialized.ok) {
      return fail("APPLY_BLOCKED", { reason: materialized.reason });
    }
    liveMappings = materialized.mappings;
  } else if (usesExplicitTargetMeetingDayPlans(snapshotOptions.targetMeetingDayPlans)) {
    const persistedDays = await persistTargetMeetingDayPlans(deps, {
      mappings: liveMappings,
      plans: snapshotOptions.targetMeetingDayPlans,
      sourceSchoolYearId: persisted.sourceSchoolYearId,
      targetSchoolYearId: persisted.targetSchoolYearId,
      selectedSourceClassIds,
      selectedSourceAnnualCourseIds: snapshotOptions.selectedSourceAnnualCourseIds,
    });
    if (!persistedDays.ok) {
      return fail("APPLY_BLOCKED", { reason: persistedDays.reason });
    }
  }
  const liveInput = await assembleLiveYearTransitionPreviewInput(
    {
      includePrivateNotes: snapshotOptions.includePrivateNotes,
      privateNotesOwnerTeacherId: snapshotOptions.privateNotesOwnerTeacherId,
      sourceSchoolYearId: persisted.sourceSchoolYearId,
      targetSchoolYearId: persisted.targetSchoolYearId,
      classMappings: liveMappings,
      selectedSourceClassIds,
      selectedSourceAnnualCourseIds: snapshotOptions.selectedSourceAnnualCourseIds,
      targetMeetingDayPlans: snapshotOptions.targetMeetingDayPlans,
    },
    deps,
  );
  const persistedInput = JSON.parse(persisted.snapshotJson) as YearTransitionPreviewInput;
  const pendingCreates = selectedSourceClassIds.length > 0;
  const currentFingerprint = pendingCreates
    ? yearTransitionSourceMaterialFingerprint(liveInput)
    : yearTransitionPreviewFingerprintFromSnapshotJson(yearTransitionPreviewMaterialSnapshotJson(liveInput));
  const expectedFingerprint = pendingCreates
    ? yearTransitionSourceMaterialFingerprint(persistedInput)
    : persisted.fingerprint;
  if (currentFingerprint !== expectedFingerprint) {
    return fail("PREVIEW_STALE", {
      persistedFingerprint: expectedFingerprint,
      currentFingerprint,
    });
  }

  const livePreview = buildYearTransitionPreview(liveInput);
  const applyNotesInput = notesInputForApply(liveInput);
  const applyNotePreview = previewPrivateNotes(applyNotesInput);
  const zeroLoss = usesExplicitTargetMeetingDayPlans(applyNotesInput.targetMeetingDayPlans);
  const noteBlockers = applyNotePreview.filter(
    (entry) =>
      entry.disposition === "BLOCKING" ||
      (entry.reason !== "PROJECTABLE" &&
        entry.reason !== "ALREADY_PRESENT" &&
        !isPrivateNoteApplySkipReason(entry.reason, { zeroLoss }) &&
        entry.disposition !== "TO_RECLASSIFY"),
  );
  if (noteBlockers.length) return fail("APPLY_BLOCKED", { noteBlockers });
  const blockers = livePreview.entries
    .filter((entry) => {
      if (BLOCKING.has(entry.reason) || entry.disposition === "BLOCKING") return true;
      if (entry.reason === "PROJECTABLE" || entry.reason === "ALREADY_PRESENT") return false;
      if (entry.disposition === "TO_RECLASSIFY") return false;
      return !skipResult(entry.reason);
    })
    .map((entry) => ({ sourceAgendaItemId: entry.sourceAgendaItemId, reason: entry.reason }));
  if (blockers.length > 0) {
    return fail("APPLY_BLOCKED", { blockers });
  }

  const sourceItems = sourceById(liveInput.sourceItems);
  const inserts: YearTransitionApplyAgendaInsert[] = [];
  const classroomByClass = new Map<string, string>();
  const subjectByCourse = new Map<string, string>();

  for (const entry of livePreview.entries) {
    const unplaced = entry.disposition === "TO_RECLASSIFY";
    if (entry.reason !== "PROJECTABLE" && !unplaced) continue;
    const source = sourceItems.get(entry.sourceAgendaItemId);
    if (!source) return fail("APPLY_BLOCKED");
    const classId = entry.targetClassId?.trim() ?? "";
    const courseId = entry.targetAnnualCourseId?.trim() ?? "";
    if (!classId || !courseId) return fail("APPLY_BLOCKED");

    let classroomId = classroomByClass.get(classId);
    if (!classroomId) {
      const resolved = await resolveClassroom(deps.adapters, classId);
      if (!resolved.ok) return resolved;
      classroomId = resolved.classroomId;
      classroomByClass.set(classId, classroomId);
    }

    const subjectKey = `${courseId}\0${classroomId}`;
    let subjectId = subjectByCourse.get(subjectKey);
    if (!subjectId) {
      const resolved = await resolveSubject(deps.adapters, courseId, classroomId);
      if (!resolved.ok) return resolved;
      subjectId = resolved.subjectId;
      subjectByCourse.set(subjectKey, subjectId);
    }

    const insert = buildInsert(
      transitionId,
      persisted.targetSchoolYearId,
      entry,
      source,
      classroomId,
      subjectId,
      unplaced,
    );
    if ("ok" in insert && insert.ok === false) return insert;
    inserts.push(insert as YearTransitionApplyAgendaInsert);
  }

  const appliedAt = deps.now?.() ?? new Date().toISOString();
  const apply: PersistedYearTransitionApply = {
    transitionId,
    fingerprint: persisted.fingerprint,
    engineVersion: persisted.engineVersion,
    appVersion: APP_VERSION,
    appliedAt,
  };
  const entries: PersistedYearTransitionApplyEntry[] = livePreview.entries.map((entry) => {
    const applyResult = expectedApplyResultForPreviewReason(entry.reason, {
      zeroLoss,
      targetAnnualCourseId: entry.targetAnnualCourseId,
    });
    return ledgerEntry(transitionId, appliedAt, entry, applyResult ?? "SKIPPED_NO_REFERENCE");
  });

  for (const item of inserts) {
    if (item.schoolYearId !== persisted.targetSchoolYearId) return fail("APPLY_BLOCKED");
  }

  const courseNoteIds = usesExplicitTargetMeetingDayPlans(applyNotesInput.targetMeetingDayPlans)
    ? [...new Set(
        [...(applyNotesInput.sourceNotes ?? []), ...(applyNotesInput.targetNotes ?? [])]
          .map((note) => note.annualCourseId)
          .filter((id): id is string => Boolean(id)),
      )]
    : undefined;
  const plan: YearTransitionApplyPlan = { apply, items: inserts, entries,
    ...(applyNotesInput.includePrivateNotes ? { noteGuard: {
      ...(courseNoteIds
        ? { annualCourseIds: courseNoteIds }
        : { ownerTeacherId: applyNotesInput.privateNotesOwnerTeacherId! }),
      sourceSchoolYearId: applyNotesInput.sourceSchoolYearId, targetSchoolYearId: applyNotesInput.targetSchoolYearId,
      expected: [...(applyNotesInput.sourceNotes ?? []), ...(applyNotesInput.targetNotes ?? [])] } } : {}),
    notes: planPrivateNoteCopies(applyNotesInput, applyNotePreview, transitionId, appliedAt) };
  try {
    await deps.applyStore.applyAtomically(plan);
  } catch (error) {
    if (String(error).includes("NOT NULL constraint failed: year_transition_previews.fingerprint")
      || String(error).includes("Private notes changed during transition")) {
      const raced = await deps.applyStore.getByTransitionId(transitionId);
      return raced ? verifyExistingApply(deps, raced, persisted) : fail("PREVIEW_STALE");
    }
    if (!isConstraintError(error)) throw error;
    const raced = await deps.applyStore.getByTransitionId(transitionId);
    if (raced) return verifyExistingApply(deps, raced, persisted);
    return fail("APPLY_CONCURRENT_CONFLICT");
  }

  return success("APPLIED", apply, entries, applyNotePreview);
}
