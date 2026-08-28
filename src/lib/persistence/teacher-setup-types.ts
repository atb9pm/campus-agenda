import type { TeacherSetupConfig } from "../../features/teacher-setup/types.ts";

export interface TeacherSetupStore {
  /** Null si l'enseignant n'a encore rien enregistré côté serveur. */
  getSetup(teacherId: string): Promise<TeacherSetupConfig | null>;
  saveSetup(teacherId: string, config: TeacherSetupConfig): Promise<TeacherSetupConfig>;
}
