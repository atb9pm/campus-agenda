export interface StudentAccessRecord {
  id: string;
  classroomId: string;
  schoolClassId: string | null;
  label: string;
  accessCodeHash: string | null;
  accessVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
  revokedAt: string | null;
}

export interface StudentAccessStore {
  getById(id: string): Promise<StudentAccessRecord | null>;
  getBySchoolClassId(schoolClassId: string): Promise<StudentAccessRecord | null>;
  listAll(): Promise<StudentAccessRecord[]>;
  saveGenerated(input: {
    schoolClassId: string;
    classroomId: string;
    label: string;
    accessCodeHash: string;
  }): Promise<StudentAccessRecord>;
  revokeBySchoolClassId(schoolClassId: string): Promise<StudentAccessRecord | null>;
  replaceAll(records: StudentAccessRecord[]): Promise<void>;
}
