import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { ClassroomCatalog } from "../classes/queries.ts";
import {
  getClassroomById,
  getClassroomsForTeacher,
  getSubjectsForTeacherInClassroom,
} from "../classes/queries.ts";
import type { Classroom } from "../../types/classroom.ts";
import type { Subject } from "../../types/classroom.ts";
import type { TeacherAgendaView } from "./workspace.ts";

export interface TeacherClassSummary {
  classroom: Classroom;
  myItemCount: number;
  classItemCount: number;
  branchesTaught: Subject[];
}

export function getItemsForClassroom(items: PrototypeAgendaItem[], classroomId: string): PrototypeAgendaItem[] {
  return items.filter((item) => item.classroomId === classroomId);
}

export function getMyItemsForClassroom(
  items: PrototypeAgendaItem[],
  teacherId: string,
  classroomId: string,
): PrototypeAgendaItem[] {
  return getItemsForClassroom(items, classroomId).filter((item) => item.authorTeacherId === teacherId);
}

export function filterItemsForAgendaView(
  items: PrototypeAgendaItem[],
  classroomId: string,
  teacherId: string,
  view: TeacherAgendaView,
): PrototypeAgendaItem[] {
  const classroomItems = getItemsForClassroom(items, classroomId);
  if (view === "class") return classroomItems;
  return classroomItems.filter((item) => item.authorTeacherId === teacherId);
}

export function getTeacherClassSummaries(
  catalog: ClassroomCatalog,
  teacherId: string,
  items: PrototypeAgendaItem[],
): TeacherClassSummary[] {
  return getClassroomsForTeacher(catalog, teacherId).map((classroom) => ({
    classroom,
    myItemCount: getMyItemsForClassroom(items, teacherId, classroom.id).length,
    classItemCount: getItemsForClassroom(items, classroom.id).length,
    branchesTaught: getSubjectsForTeacherInClassroom(catalog, teacherId, classroom.id),
  }));
}

export function getAgendaSectionTitle(view: TeacherAgendaView, classroomName: string): string {
  if (view === "mine") return "Mes éléments";
  return `Agenda partagé · ${classroomName}`;
}

export function getAgendaSectionDescription(view: TeacherAgendaView, classroomName: string): string {
  if (view === "mine") {
    return `Vos publications dans la classe ${classroomName}.`;
  }
  return "Planifiez la semaine et visualisez la charge globale de la classe.";
}

export function resolveClassroomLabel(catalog: ClassroomCatalog, classroomId: string): string {
  return getClassroomById(catalog, classroomId)?.name ?? "Classe";
}
