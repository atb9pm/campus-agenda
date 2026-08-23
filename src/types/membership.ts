export interface Membership {
  id: string;
  teacherId: string;
  classroomId: string;
  subjectIds: string[];
  validFrom: string;
  validTo: string | null;
}
