import { APP_VERSION } from "../../lib/app-version.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { PedagogicalPathStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
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
  YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
  yearTransitionPreviewFingerprintFromSnapshotJson,
  yearTransitionPreviewMaterialSnapshotJson,
} from "./fingerprint.ts";
import { YEAR_TRANSITION_AGENDA_COMPAT_HOUR, buildYearTransitionPreview } from "./preview.ts";
import { extractClassMappingsFromSnapshotJson, YearTransitionSnapshotCorruptedError } from "./snapshot-mappings.ts";
import type { PersistedYearTransitionPreview, YearTransitionPreviewStore } from "./store.ts";
import type { YearTransitionPreviewEntry, YearTransitionPreviewReason } from "./types.ts";

export interface ApplyPersistedYearTransitionDeps {
  previews: YearTransitionPreviewStore;
  applyStore: YearTransitionApplyStore;
  years: SchoolYearStore;
  courses: AnnualCourseStore;
  agenda: AgendaStore;
  paths: PedagogicalPathStore;
  schedules: CourseScheduleStore;
  adapters: RuntimeAgendaAdapterStore;
  now?: () => string;
}

const BLOCKING = new Set<string>(YEAR_TRANSITION_APPLY_BLOCKING_REASONS);
const APPLY_RESULTS = new Set<string>(YEAR_TRANSITION_APPLY_RESULTS);

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
  if (reason === "ORPHAN_NO_REFERENCE_ITEM") return "SKIPPED_NO_REFERENCE";
  if (reason === "ORPHAN_DEAD_REFERENCE_ITEM") return "SKIPPED_DEAD_REFERENCE";
  return null;
}

export function expectedApplyResultForPreviewReason(
  reason: YearTransitionPreviewReason | string,
): YearTransitionApplyResult | null {
  if (reason === "PROJECTABLE") return "CREATED";
  if (reason === "ALREADY_PRESENT") return "ALREADY_PRESENT";
  return skipResult(reason);
}

function sameNullableId(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = left?.trim() ? left.trim() : null;
  const normalizedRight = right?.trim() ? right.trim() : null;
  return normalizedLeft === normalizedRight;
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
  let alreadyPresentCount = 0;
  let skippedCount = 0;
  for (const entry of entries) {
    if (entry.applyResult === "CREATED") createdCount += 1;
    else if (entry.applyResult === "ALREADY_PRESENT") alreadyPresentCount += 1;
    else skippedCount += 1;
  }
  return { createdCount, alreadyPresentCount, skippedCount };
}

function success(
  code: "APPLIED" | "ALREADY_APPLIED",
  apply: PersistedYearTransitionApply,
  entries: PersistedYearTransitionApplyEntry[],
): YearTransitionApplyOutcome {
  return {
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
    if (!sameNullableId(entry.targetAnnualCourseId, previewEntry.targetAnnualCourseId)) {
      return fail("APPLY_LEDGER_DIVERGED");
    }
    if (!sameNullableId(entry.referenceItemId, previewEntry.referenceItemId)) {
      return fail("APPLY_LEDGER_DIVERGED");
    }
    const expectedResult = expectedApplyResultForPreviewReason(previewEntry.reason);
    if (!expectedResult || !isKnownApplyResult(entry.applyResult) || entry.applyResult !== expectedResult) {
      return fail("APPLY_LEDGER_DIVERGED");
    }

    if (entry.applyResult === "CREATED") {
      const found = itemsWithApplyProvenance(items, apply.transitionId, entry.sourceAgendaItemId);
      if (found.length !== 1) return fail("APPLY_LEDGER_DIVERGED");
      const created = found[0]!;
      if ((created.annualCourseId ?? null) !== (entry.targetAnnualCourseId ?? null)) {
        return fail("APPLY_LEDGER_DIVERGED");
      }
      if ((created.referenceItemId ?? null) !== (entry.referenceItemId ?? null)) {
        return fail("APPLY_LEDGER_DIVERGED");
      }
      continue;
    }
    if (entry.applyResult === "ALREADY_PRESENT") {
      const provenance = itemsWithApplyProvenance(items, apply.transitionId, entry.sourceAgendaItemId);
      if (provenance.length !== 0) return fail("APPLY_LEDGER_DIVERGED");
      const courseId = entry.targetAnnualCourseId?.trim() ?? "";
      const referenceId = entry.referenceItemId?.trim() ?? "";
      if (!courseId || !referenceId) return fail("APPLY_LEDGER_DIVERGED");
      const found = items.filter(
        (item) => (item.annualCourseId ?? null) === courseId && (item.referenceItemId ?? null) === referenceId,
      );
      if (found.length !== 1) return fail("APPLY_LEDGER_DIVERGED");
      continue;
    }
    const unexpected = itemsWithApplyProvenance(items, apply.transitionId, entry.sourceAgendaItemId);
    if (unexpected.length !== 0) return fail("APPLY_LEDGER_DIVERGED");
  }
  return success("ALREADY_APPLIED", apply, applyEntries);
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
): YearTransitionApplyAgendaInsert | YearTransitionApplyFailure {
  const placement = entry.proposedPlacement;
  const referenceItemId = entry.referenceItemId?.trim() ?? "";
  const referenceSessionId = entry.resolvedReferenceSessionId?.trim() ?? "";
  const annualCourseId = entry.targetAnnualCourseId?.trim() ?? "";
  if (!placement || !referenceItemId || !referenceSessionId || !annualCourseId) {
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
    referenceSessionId,
    referenceItemId,
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

  const liveInput = await assembleLiveYearTransitionPreviewInput(
    {
      sourceSchoolYearId: persisted.sourceSchoolYearId,
      targetSchoolYearId: persisted.targetSchoolYearId,
      classMappings,
    },
    deps,
  );
  const currentSnapshotJson = yearTransitionPreviewMaterialSnapshotJson(liveInput);
  const currentFingerprint = yearTransitionPreviewFingerprintFromSnapshotJson(currentSnapshotJson);
  if (currentFingerprint !== persisted.fingerprint) {
    return fail("PREVIEW_STALE", {
      persistedFingerprint: persisted.fingerprint,
      currentFingerprint,
    });
  }

  const livePreview = buildYearTransitionPreview(liveInput);
  const blockers = livePreview.entries
    .filter((entry) => BLOCKING.has(entry.reason) || (entry.reason !== "PROJECTABLE" && entry.reason !== "ALREADY_PRESENT" && !skipResult(entry.reason)))
    .map((entry) => ({ sourceAgendaItemId: entry.sourceAgendaItemId, reason: entry.reason }));
  if (blockers.length > 0) {
    return fail("APPLY_BLOCKED", { blockers });
  }

  const sourceItems = sourceById(liveInput.sourceItems);
  const inserts: YearTransitionApplyAgendaInsert[] = [];
  const classroomByClass = new Map<string, string>();
  const subjectByCourse = new Map<string, string>();

  for (const entry of livePreview.entries) {
    if (entry.reason !== "PROJECTABLE") continue;
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

    const insert = buildInsert(transitionId, persisted.targetSchoolYearId, entry, source, classroomId, subjectId);
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
    if (entry.reason === "PROJECTABLE") return ledgerEntry(transitionId, appliedAt, entry, "CREATED");
    if (entry.reason === "ALREADY_PRESENT") return ledgerEntry(transitionId, appliedAt, entry, "ALREADY_PRESENT");
    const skipped = skipResult(entry.reason);
    return ledgerEntry(transitionId, appliedAt, entry, skipped ?? "SKIPPED_NO_REFERENCE");
  });

  for (const item of inserts) {
    if (item.schoolYearId !== persisted.targetSchoolYearId) return fail("APPLY_BLOCKED");
  }

  const plan: YearTransitionApplyPlan = { apply, items: inserts, entries };
  try {
    await deps.applyStore.applyAtomically(plan);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await deps.applyStore.getByTransitionId(transitionId);
    if (raced) return verifyExistingApply(deps, raced, persisted);
    return fail("APPLY_CONCURRENT_CONFLICT");
  }

  return success("APPLIED", apply, entries);
}
