import { runtimeClassroomIdForSchoolClass, runtimeSubjectIdForAnnualCourse } from "../agenda-bridge/index.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { ClassNotesDocument } from "../class-notebook/types.ts";
import type { CourseScheduleSlot } from "../course-schedule/types.ts";
import {
  COURSE_TIMELINE_FORBIDDEN_REASON,
  getTeacherCourseTimeline,
  type CourseTimelineServiceDeps,
  type TeacherCourseTimelineCourse,
} from "../course-timeline/index.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import { formatSwissDate } from "../course-sessions/format.ts";
import { assembleNotebookExport } from "./assemble.ts";
import { notebookExportFilename } from "./filename.ts";
import { parseNotebookExportOptions } from "./options.ts";
import { renderNotebookExportPdf } from "./pdf.ts";
import { formatCourseScheduleSummary } from "./schedule-summary.ts";
import { selectLegacyTestsForAnnualCourseExport } from "./session-match.ts";
import {
  NOTEBOOK_EXPORT_EMPTY_REASON,
  NOTEBOOK_EXPORT_FAILED_REASON,
  type NotebookExportOptions,
} from "./types.ts";

export interface NotebookExportServiceDeps extends CourseTimelineServiceDeps {
  agenda: {
    listAgendaItemsByAnnualCourse(annualCourseId: string): Promise<PrototypeAgendaItem[]>;
    listAgendaItems?(classroomId: string): Promise<PrototypeAgendaItem[]>;
  };
  notes: { getNotes(teacherId: string): Promise<ClassNotesDocument | null> };
}

async function collectNotebookExportItems(
  deps: NotebookExportServiceDeps,
  course: TeacherCourseTimelineCourse,
  sessions: readonly CourseSession[],
): Promise<PrototypeAgendaItem[]> {
  const courseItems = await deps.agenda.listAgendaItemsByAnnualCourse(course.annualCourseId);
  if (!deps.agenda.listAgendaItems) return courseItems;
  const classroomId = runtimeClassroomIdForSchoolClass(course.classId);
  const subjectId = runtimeSubjectIdForAnnualCourse(course.annualCourseId);
  const classroomItems = await deps.agenda.listAgendaItems(classroomId);
  const legacy = selectLegacyTestsForAnnualCourseExport(
    classroomItems,
    {
      annualCourseId: course.annualCourseId,
      classroomId,
      subjectId,
      schoolYearId: course.schoolYearId,
    },
    sessions,
  );
  const seen = new Set(courseItems.map((item) => item.id));
  return [...courseItems, ...legacy.filter((item) => !seen.has(item.id))];
}

export type NotebookExportOk = { ok: true; pdf: Uint8Array; filename: string };
export type NotebookExportErr = { ok: false; reason: string; status: number };
export type NotebookExportResult = NotebookExportOk | NotebookExportErr;

function todaySwiss(now = new Date()): string {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return formatSwissDate(iso);
}

export async function exportTeacherNotebookPdf(
  deps: NotebookExportServiceDeps,
  input: {
    teacherId: string;
    annualCourseId: string;
    options?: unknown;
    at?: string;
    now?: Date;
  },
): Promise<NotebookExportResult> {
  const options: NotebookExportOptions = parseNotebookExportOptions(input.options);
  const timeline = await getTeacherCourseTimeline(deps, {
    teacherId: input.teacherId,
    annualCourseId: input.annualCourseId,
    at: input.at,
  });
  if (!timeline.ok) {
    return { ok: false, reason: timeline.reason, status: timeline.status };
  }

  const year = await deps.years.getSchoolYearById(timeline.course.schoolYearId);
  const slots: CourseScheduleSlot[] = await deps.schedules.listSlotsByAnnualCourse(timeline.course.annualCourseId);
  const sessions = timeline.timeline.entries.map((entry) => entry.courseSession);
  const items = await collectNotebookExportItems(deps, timeline.course, sessions);
  const notes = options.includeTeacherNotes ? await deps.notes.getNotes(input.teacherId) : null;
  const teacher = deps.teachers ? await deps.teachers.findAccount(input.teacherId) : null;

  const assembled = assembleNotebookExport({
    sessions,
    weeks: year?.weeks ?? [],
    items,
    annualCourseId: timeline.course.annualCourseId,
    notes,
    classId: timeline.course.classId,
    classCode: timeline.course.classCode,
    classLabel: timeline.course.classLabel || timeline.course.classCode,
    branchLabel: timeline.course.branchLabel,
    schoolYearLabel: timeline.course.schoolYearLabel,
    teacherName: teacher?.displayName?.trim() || "Enseignant",
    scheduleSummary: formatCourseScheduleSummary(slots),
    generatedOn: todaySwiss(input.now),
    options,
  });

  if (!assembled) {
    return { ok: false, reason: NOTEBOOK_EXPORT_EMPTY_REASON, status: 422 };
  }

  try {
    const pdf = await renderNotebookExportPdf(assembled);
    return {
      ok: true,
      pdf,
      filename: notebookExportFilename({
        classCode: assembled.classCode,
        branchLabel: assembled.branchLabel,
        schoolYearLabel: assembled.schoolYearLabel,
      }),
    };
  } catch {
    return { ok: false, reason: NOTEBOOK_EXPORT_FAILED_REASON, status: 500 };
  }
}

export { COURSE_TIMELINE_FORBIDDEN_REASON };
