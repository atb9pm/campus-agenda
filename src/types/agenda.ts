export const AGENDA_ITEM_TYPES = ["HOMEWORK", "TEST", "INFORMATION"] as const;

export type AgendaItemType = (typeof AGENDA_ITEM_TYPES)[number];

export interface AgendaItem {
  id: string;
  classroomId: string;
  subjectId: string;
  authorTeacherId: string;
  type: AgendaItemType;
  title: string;
  description?: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
}

