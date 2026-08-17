export interface Classroom {
  id: string;
  name: string;
  programLabel: string;
  accessCodeHint: string;
}

export interface Subject {
  id: string;
  classroomId: string;
  name: string;
}
