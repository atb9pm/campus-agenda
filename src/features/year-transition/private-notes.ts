import { createHash } from "node:crypto";
import { copyNoteToNewYear, type AnnualCourseNote } from "../pedagogical-path/annual-notes.ts";
import type { YearTransitionPreviewInput } from "./types.ts";
import { indexClassMappings, resolveClassMapping } from "./class-mapping.ts";

export interface PrivateNotePreviewEntry {
  sourceNoteId: string;
  sourceClassId: string | null;
  reason: "PROJECTABLE" | "ALREADY_PRESENT" | "NO_CONTINUATION" | "NO_REFERENCE"
    | "MAPPING_UNRESOLVED" | "TARGET_COURSE_UNRESOLVED" | "REFERENCE_UNRESOLVED"
    | "TARGET_SESSION_UNRESOLVED" | "TARGET_NOTE_DIVERGED";
  targetAnnualCourseId: string | null;
  targetClassId: string | null;
  referenceSessionId: string | null;
  courseSessionKey: string | null;
}

/** No week/date offset guessing: only a pedagogical reference can place a note. */
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
      const refs = new Set(input.sourceItems.filter(item => note.courseSessionKey && item.courseSessionKey === note.courseSessionKey
        && item.annualCourseId === source.id && item.schoolYearId === input.sourceSchoolYearId)
        .map(item => item.referenceSessionId).filter((id): id is string => Boolean(id)));
      if (note.referenceSessionId) refs.add(note.referenceSessionId);
      let ref = refs.size === 1 ? [...refs][0]! : null;
      if (!ref && refs.size === 0 && note.courseSessionKey) {
        const sourceSessions = (input.sourceCourseSessions ?? []).filter(
          (session) =>
            session.key === note.courseSessionKey &&
            session.annualCourseId === source.id &&
            session.classId === source.classId,
        );
        if (sourceSessions.length === 1) {
          const position = sourceSessions[0]!.sequenceNumber;
          const pathSessions = input.pathSnapshots
            .filter((path) => path.contextId === source.contextId)
            .flatMap((path) => path.sessions)
            .filter((session) => session.position === position);
          if (pathSessions.length === 1) ref = pathSessions[0]!.id;
        }
      }
      if (!ref && refs.size === 0) return result("NO_REFERENCE");
      if (!ref) return result("REFERENCE_UNRESOLVED");
      const sessions = input.pathSnapshots.filter(p => p.contextId === source.contextId)
        .flatMap(p => p.sessions);
      const hits = sessions.filter(s => s.id === ref);
      if (hits.length !== 1 || !Number.isInteger(hits[0]!.position) || hits[0]!.position < 1
        || sessions.filter(s => s.position === hits[0]!.position).length !== 1) return result("REFERENCE_UNRESOLVED");
      entry.referenceSessionId = ref;
      const targets = input.targetCourseSessions.filter(s => s.schoolYearId === input.targetSchoolYearId
        && s.annualCourseId === entry.targetAnnualCourseId && s.classId === entry.targetClassId
        && s.contextId === source.contextId && s.sequenceNumber === hits[0]!.position);
      if (targets.length !== 1) return result("TARGET_SESSION_UNRESOLVED");
      entry.courseSessionKey = targets[0]!.key;
      const existing = (input.targetNotes ?? []).filter(n => n.sourceNoteId === note.id && n.ownerTeacherId === owner
        && n.schoolYearId === input.targetSchoolYearId);
      if (!existing.length) return entry;
      const match = existing.length === 1 && existing[0]!.annualCourseId === entry.targetAnnualCourseId
        && existing[0]!.classId === entry.targetClassId && existing[0]!.contextId === source.contextId
        && existing[0]!.referenceSessionId === ref && existing[0]!.courseSessionKey === entry.courseSessionKey
        && existing[0]!.sourceSchoolYearId === input.sourceSchoolYearId;
      return result(match ? "ALREADY_PRESENT" : "TARGET_NOTE_DIVERGED");
    });
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
