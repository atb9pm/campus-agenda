import { createHash } from "node:crypto";
import { copyNoteToNewYear, type AnnualCourseNote } from "../pedagogical-path/annual-notes.ts";
import type { YearTransitionPreviewInput } from "./types.ts";
import { indexClassMappings, resolveClassMapping } from "./class-mapping.ts";
import {
  pathSessionsForContext,
  resolveUniqueSourceCourseSessionFromKey,
  uniquePathSessionAtPosition,
  uniqueTargetSessionAtSequence,
} from "./session-anchor.ts";

export interface PrivateNotePreviewEntry {
  sourceNoteId: string;
  sourceClassId: string | null;
  reason: "PROJECTABLE" | "ALREADY_PRESENT" | "NO_CONTINUATION" | "NO_REFERENCE"
    | "SOURCE_SESSION_UNRESOLVED" | "PATH_ABSENT" | "PATH_POSITION_UNRESOLVED"
    | "MAPPING_UNRESOLVED" | "TARGET_COURSE_UNRESOLVED" | "REFERENCE_UNRESOLVED"
    | "TARGET_SESSION_UNRESOLVED" | "TARGET_NOTE_DIVERGED";
  targetAnnualCourseId: string | null;
  targetClassId: string | null;
  referenceSessionId: string | null;
  courseSessionKey: string | null;
}

const NOTE_SKIP_WITHOUT_PLACEMENT = new Set<PrivateNotePreviewEntry["reason"]>([
  "NO_CONTINUATION",
  "NO_REFERENCE",
  "SOURCE_SESSION_UNRESOLVED",
  "PATH_ABSENT",
  "PATH_POSITION_UNRESOLVED",
  "TARGET_SESSION_UNRESOLVED",
]);

export function isPrivateNoteApplySkipReason(reason: PrivateNotePreviewEntry["reason"]): boolean {
  return NOTE_SKIP_WITHOUT_PLACEMENT.has(reason);
}

/** Placement N+1 : séance annuelle réelle, parcours CTX facultatif. */
export function previewPrivateNotes(input: YearTransitionPreviewInput): PrivateNotePreviewEntry[] {
  if (!input.includePrivateNotes) return [];
  const owner = input.privateNotesOwnerTeacherId?.trim();
  if (!owner) throw new Error("Le propriétaire des notes privées est obligatoire.");
  const mapping = indexClassMappings(input.classMappings);
  return [...(input.sourceNotes ?? [])].filter(n => n.ownerTeacherId === owner && n.schoolYearId === input.sourceSchoolYearId)
    .sort((a, b) => a.id.localeCompare(b.id)).map(note => {
      const entry: PrivateNotePreviewEntry = { sourceNoteId: note.id, sourceClassId: note.classId, reason: "PROJECTABLE",
        targetAnnualCourseId: null, targetClassId: null, referenceSessionId: null, courseSessionKey: null };
      const result = (reason: PrivateNotePreviewEntry["reason"]) => ({ ...entry, reason });
      const source = input.sourceCourses.find(c => c.id === note.annualCourseId && c.schoolYearId === note.schoolYearId
        && c.classId === note.classId && c.contextId === note.contextId);
      if (!source) return result("MAPPING_UNRESOLVED");
      const resolved = resolveClassMapping(source.classId, mapping);
      if (resolved.status === "no_continuation") return result("NO_CONTINUATION");
      if (resolved.status !== "one_to_one") return result("MAPPING_UNRESOLVED");
      entry.targetClassId = resolved.targetClassId;
      const courses = input.targetCourses.filter(c => c.schoolYearId === input.targetSchoolYearId
        && c.classId === resolved.targetClassId && c.contextId === source.contextId);
      if (courses.length !== 1 || courses[0]!.isArchived) return result("TARGET_COURSE_UNRESOLVED");
      entry.targetAnnualCourseId = courses[0]!.id;

      const sourceSession = resolveUniqueSourceCourseSessionFromKey(
        note.courseSessionKey,
        source,
        input.sourceCourseSessions ?? [],
      );
      if (sourceSession) {
        const pathSessions = pathSessionsForContext(input.pathSnapshots, source.contextId);
        const ctx = uniquePathSessionAtPosition(pathSessions, sourceSession.sequenceNumber);
        entry.referenceSessionId = ctx?.id ?? null;
        const target = uniqueTargetSessionAtSequence(
          input.targetCourseSessions,
          {
            schoolYearId: input.targetSchoolYearId,
            annualCourseId: entry.targetAnnualCourseId,
            classId: entry.targetClassId,
            contextId: source.contextId,
          },
          sourceSession.sequenceNumber,
        );
        if (!target) return result("TARGET_SESSION_UNRESOLVED");
        entry.courseSessionKey = target.key;
        return notePresence(input, note, owner, entry, source.contextId);
      }

      const refs = new Set(input.sourceItems.filter(item => note.courseSessionKey && item.courseSessionKey === note.courseSessionKey
        && item.annualCourseId === source.id && item.schoolYearId === input.sourceSchoolYearId)
        .map(item => item.referenceSessionId).filter((id): id is string => Boolean(id)));
      if (note.referenceSessionId) refs.add(note.referenceSessionId);
      const ref = refs.size === 1 ? [...refs][0]! : null;
      if (!ref && refs.size > 0) return result("REFERENCE_UNRESOLVED");
      if (!ref) {
        if (note.courseSessionKey?.trim()) return result("SOURCE_SESSION_UNRESOLVED");
        return result("NO_REFERENCE");
      }
      const sessions = pathSessionsForContext(input.pathSnapshots, source.contextId);
      if (sessions.length === 0) return result("PATH_ABSENT");
      const hits = sessions.filter(s => s.id === ref);
      if (hits.length === 0) return result("PATH_POSITION_UNRESOLVED");
      if (hits.length !== 1 || !Number.isInteger(hits[0]!.position) || hits[0]!.position < 1
        || sessions.filter(s => s.position === hits[0]!.position).length !== 1) return result("REFERENCE_UNRESOLVED");
      entry.referenceSessionId = ref;
      const target = uniqueTargetSessionAtSequence(
        input.targetCourseSessions,
        {
          schoolYearId: input.targetSchoolYearId,
          annualCourseId: entry.targetAnnualCourseId,
          classId: entry.targetClassId,
          contextId: source.contextId,
        },
        hits[0]!.position,
      );
      if (!target) return result("TARGET_SESSION_UNRESOLVED");
      entry.courseSessionKey = target.key;
      return notePresence(input, note, owner, entry, source.contextId);
    });
}

function notePresence(
  input: YearTransitionPreviewInput,
  note: AnnualCourseNote,
  owner: string,
  entry: PrivateNotePreviewEntry,
  contextId: string,
): PrivateNotePreviewEntry {
  const existing = (input.targetNotes ?? []).filter(n => n.sourceNoteId === note.id && n.ownerTeacherId === owner
    && n.schoolYearId === input.targetSchoolYearId);
  if (!existing.length) return entry;
  const match = existing.length === 1 && existing[0]!.annualCourseId === entry.targetAnnualCourseId
    && existing[0]!.classId === entry.targetClassId && existing[0]!.contextId === contextId
    && existing[0]!.referenceSessionId === entry.referenceSessionId
    && existing[0]!.courseSessionKey === entry.courseSessionKey
    && existing[0]!.sourceSchoolYearId === input.sourceSchoolYearId;
  return { ...entry, reason: match ? "ALREADY_PRESENT" : "TARGET_NOTE_DIVERGED" };
}

export function privateNoteCopyId(transitionId: string, sourceId: string): string {
  return "yn-" + createHash("sha256").update(JSON.stringify([transitionId, sourceId])).digest("hex");
}

export function planPrivateNoteCopies(input: YearTransitionPreviewInput, entries: readonly PrivateNotePreviewEntry[],
  transitionId: string, inheritedAt: string): AnnualCourseNote[] {
  return entries.filter(e => e.reason === "PROJECTABLE").map(entry => {
    const source = input.sourceNotes!.find(n => n.id === entry.sourceNoteId)!;
    const copy = copyNoteToNewYear(source, { id: privateNoteCopyId(transitionId, source.id),
      schoolYearId: input.targetSchoolYearId, classId: entry.targetClassId!, annualCourseId: entry.targetAnnualCourseId!,
      authorTeacherId: source.authorTeacherId, ownerTeacherId: source.ownerTeacherId,
      referenceSessionId: entry.referenceSessionId }, inheritedAt);
    return { ...copy, courseSessionKey: entry.courseSessionKey };
  });
}
