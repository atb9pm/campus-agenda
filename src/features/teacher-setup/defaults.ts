import type { ClassroomCatalog } from "../classes/queries.ts";
import { getClassroomsForTeacher, getSubjectsForTeacherInClassroom } from "../classes/queries.ts";
import type { TeacherClassSetup, TeacherSetupConfig, WeekdayIndex } from "./types.ts";

const CLASS_ICONS = ["🔧", "⚙️", "🛠️", "🔩", "⚡", "📐", "🎓", "📋"];

/** Jours par défaut pour le compte ChF — à ajuster dans Configuration. */
const CHF_DEFAULT_DAYS: Record<string, WeekdayIndex> = {
  "classe-chf-ma2": 1,
  "classe-chf-ma3b": 2,
  "classe-chf-ma3ab": 1,
  "classe-chf-mma1c": 3,
  "classe-chf-mma2c": 4,
  "classe-chf-mma3a": 1,
  "classe-chf-ama2a": 2,
  "classe-chf-pai": 4,
};

function iconForClassroom(classroomId: string, index: number): string {
  return CLASS_ICONS[index % CLASS_ICONS.length];
}

export function buildDefaultTeacherSetup(
  catalog: ClassroomCatalog,
  teacherId: string,
): TeacherSetupConfig {
  const classrooms = getClassroomsForTeacher(catalog, teacherId);
  const classes: TeacherClassSetup[] = classrooms.map((classroom, index) => ({
    id: classroom.id,
    name: classroom.name,
    programLabel: classroom.programLabel,
    dayOfWeek: CHF_DEFAULT_DAYS[classroom.id] ?? (((index % 5) + 1) as WeekdayIndex),
    branchNames: getSubjectsForTeacherInClassroom(catalog, teacherId, classroom.id).map(
      (subject) => subject.name,
    ),
    icon: iconForClassroom(classroom.id, index),
  }));

  return { version: 1, classes };
}

export function createEmptyClassSetup(index = 0): TeacherClassSetup {
  return {
    id: `classe-manuelle-${Date.now()}-${index}`,
    name: "",
    programLabel: "Mécanique automobile",
    dayOfWeek: 1,
    branchNames: [],
    icon: CLASS_ICONS[index % CLASS_ICONS.length],
  };
}
