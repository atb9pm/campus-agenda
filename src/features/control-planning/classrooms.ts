import type { AnnualCourse, TeacherCourseAssignment } from "../annual-courses/types.ts";
import { teacherHasStructuredClassroomReadAccess } from "../agenda-bridge/access.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import type { RuntimeClassroomListItem } from "../../lib/persistence/runtime-agenda-types.ts";
import type { ControlPlanningClass } from "./types.ts";

export async function listAccessibleRuntimeClassroomsForTeacher(options: {
  teacherId: string;
  classrooms: RuntimeClassroomListItem[];
  classes: SchoolClassRecord[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  teacherCanAccessClassroom: (teacherId: string, classroomId: string) => Promise<boolean>;
}): Promise<ControlPlanningClass[]> {
  const accessible: ControlPlanningClass[] = [];
  const seen = new Set<string>();
  for (const classroom of options.classrooms) {
    if (seen.has(classroom.id)) continue;
    const linkedId = classroom.schoolClassId?.trim() || null;
    const linked = linkedId ? options.classes.find((entry) => entry.id === linkedId) ?? null : null;
    const allowed = linked
      ? teacherHasStructuredClassroomReadAccess({
          teacherId: options.teacherId,
          schoolClass: linked,
          courses: options.courses,
          assignments: options.assignments,
          years: options.years,
        })
      : await options.teacherCanAccessClassroom(options.teacherId, classroom.id);
    if (!allowed) continue;
    seen.add(classroom.id);
    accessible.push({ id: classroom.id, name: classroom.name });
  }
  return accessible;
}
