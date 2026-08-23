import type { AgendaItemType } from "../../types/agenda.ts";

/** Élément d'agenda affiché dans le prototype (planning hebdomadaire). */
export interface PrototypeAgendaItem {
  id: number;
  classroomId: string;
  subjectId: string;
  authorTeacherId: string;
  day: number;
  hour: number;
  weekOffset: number;
  schoolWeekNumber: number;
  type: AgendaItemType;
  title: string;
  detail: string;
  /** Lien vers un modèle de bibliothèque (instance dérivée). */
  templateId?: string | null;
  /** Année scolaire de rattachement (phase 2.1+). */
  schoolYearId?: string | null;
}

export const DEMO_PROTOTYPE_ITEMS: PrototypeAgendaItem[] = [
  {
    id: 1,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-chassis-2a",
    authorTeacherId: "teacher-demo-dupont",
    day: 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "Système de freinage",
    detail: "Exercices 12 à 18",
  },
  {
    id: 2,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-atelier-2a",
    authorTeacherId: "teacher-demo-dupont",
    day: 0,
    hour: 11,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "INFORMATION",
    title: "Tenue de travail",
    detail: "Lunettes de protection",
  },
  {
    id: 3,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-electricite-2a",
    authorTeacherId: "teacher-demo-current",
    day: 3,
    hour: 13,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "TEST",
    title: "Injection électronique",
    detail: "Capteurs et actionneurs",
  },
  {
    id: 4,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: "teacher-demo-martin",
    day: 3,
    hour: 10,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "Distribution",
    detail: "Compléter le schéma",
  },
  {
    id: 5,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: "teacher-demo-current",
    day: 0,
    hour: 14,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "INFORMATION",
    title: "Dossier technique",
    detail: "Document disponible",
  },
  {
    id: 6,
    classroomId: "classe-demo-tma-1a",
    subjectId: "subject-demo-moteur-1a",
    authorTeacherId: "teacher-demo-martin",
    day: 0,
    hour: 10,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "Soupapes et culasse",
    detail: "Schéma à annoter",
  },
  {
    id: 7,
    classroomId: "classe-demo-tma-1a",
    subjectId: "subject-demo-chassis-1a",
    authorTeacherId: "teacher-demo-current",
    day: 3,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "TEST",
    title: "Géométrie des trains",
    detail: "Parallélisme et carrossage",
  },
  {
    id: 8,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-chassis-2a",
    authorTeacherId: "teacher-demo-dupont",
    day: 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "TEST",
    title: "Freinage et adhérence",
    detail: "Contrôle pratique",
  },
  {
    id: 9,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-maths-2a",
    authorTeacherId: "teacher-demo-martin",
    day: 0,
    hour: 11,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "TEST",
    title: "Calculs de couples",
    detail: "Application mécanique",
  },
];
